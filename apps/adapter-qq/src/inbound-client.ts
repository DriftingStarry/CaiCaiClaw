import WebSocket from "ws";
import type { RawData } from "ws";

import { parseServerMessage, serializeClientMessage } from "@caicaiclaw/protocol";
import type { ChannelEvent } from "@caicaiclaw/utils/history";

const MAX_QUEUED_INPUTS = 512;
const MAX_PENDING_INPUTS = 2_048;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export type QqInboundDispositionInfo = {
    requestId: string;
    disposition: string;
    reason?: string;
    batchId?: string;
};

export type QqInboundClientOptions = {
    serverUrl: string;
    channel: string;
    token?: string;
    onDisposition?: (info: QqInboundDispositionInfo) => void;
};

type PendingInput = {
    event: ChannelEvent;
    queued: boolean;
    retryCount: number;
    retryTimer: ReturnType<typeof setTimeout> | null;
};

export class QqInboundClient {
    private readonly serverUrl: string;
    private readonly channel: string;
    private readonly onDisposition?: (info: QqInboundDispositionInfo) => void;
    private readonly pending = new Map<string, PendingInput>();
    private readonly queuedRequestIds: string[] = [];

    private socket: WebSocket | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    private nextRequestId = 1;
    private started = false;
    private closed = false;

    constructor(options: QqInboundClientOptions) {
        const serverUrl = new URL(options.serverUrl);
        if (options.token !== undefined) serverUrl.searchParams.set("token", options.token);

        this.serverUrl = serverUrl.toString();
        this.channel = options.channel;
        this.onDisposition = options.onDisposition;
    }

    public start(): void {
        if (this.started || this.closed) return;

        this.started = true;
        this.connect();
    }

    public async send(event: ChannelEvent): Promise<void> {
        if (this.closed) throw new Error("QqInboundClient is closed");

        const requestId = String(this.nextRequestId);
        this.nextRequestId += 1;
        this.addPending(requestId, { event, queued: false, retryCount: 0, retryTimer: null });

        const pending = this.pending.get(requestId);
        if (!pending) return;

        if (this.isConnected()) {
            this.sendPending(requestId, pending);
        } else {
            this.enqueuePending(requestId);
        }
    }

    public close(): void {
        if (this.closed) return;

        this.closed = true;
        this.started = false;
        this.clearReconnectTimer();

        for (const pending of this.pending.values()) this.clearRetryTimer(pending);
        this.pending.clear();
        this.queuedRequestIds.length = 0;

        const socket = this.socket;
        this.socket = null;
        if (!socket) return;

        try {
            socket.close(1_000, "Client closed");
        } catch (error) {
            console.error("[QqInboundClient] Failed to close WebSocket:", errorName(error));
            socket.terminate();
        }
    }

    public isConnected(): boolean {
        return this.socket?.readyState === WebSocket.OPEN;
    }

    public pendingCount(): number {
        return this.pending.size;
    }

    private connect(): void {
        if (!this.started || this.closed || this.socket) return;

        try {
            const socket = new WebSocket(this.serverUrl);
            this.socket = socket;
            socket.on("open", () => this.handleOpen(socket));
            socket.on("message", (data: RawData) => this.handleMessage(socket, data));
            socket.on("error", (error: Error) => this.handleError(socket, error));
            socket.on("close", () => this.handleClose(socket));
        } catch (error) {
            console.error("[QqInboundClient] Failed to establish connection:", errorName(error));
            this.scheduleReconnect();
        }
    }

    private handleOpen(socket: WebSocket): void {
        if (this.socket !== socket || this.closed) return;

        this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
        try {
            socket.send(serializeClientMessage({ type: "role", role: "adapter", channel: this.channel }));
        } catch (error) {
            this.handleSocketFailure(socket, error);
            return;
        }

        this.flushQueue();
    }

    private handleMessage(socket: WebSocket, data: RawData): void {
        if (this.socket !== socket || this.closed) return;

        let message;
        try {
            message = parseServerMessage(data.toString());
        } catch (error) {
            console.error("[QqInboundClient] Invalid server message:", errorName(error));
            return;
        }

        if (!message || message.type !== "ack") return;
        this.handleAck(message);
    }

    private handleAck(message: Extract<ReturnType<typeof parseServerMessage>, { type: "ack" }>): void {
        if (!message.requestId) {
            console.warn("[QqInboundClient] Ignoring ack without requestId");
            return;
        }

        const dispositionInfo: QqInboundDispositionInfo = {
            requestId: message.requestId,
            disposition: message.disposition ?? "unknown",
            ...(message.reason !== undefined ? { reason: message.reason } : {}),
            ...(message.batchId !== undefined ? { batchId: message.batchId } : {}),
        };
        try {
            this.onDisposition?.(dispositionInfo);
        } catch (error) {
            console.error("[QqInboundClient] onDisposition callback failed:", errorName(error));
        }

        const pending = this.pending.get(message.requestId);
        if (!pending) {
            console.warn(`[QqInboundClient] Received ack for unknown requestId ${message.requestId}`);
            return;
        }

        if (message.disposition === "dropped" && message.reason === "buffer_full") {
            if (pending.retryTimer) return;
            if (pending.retryCount < MAX_RETRIES) {
                this.scheduleRetry(message.requestId, pending);
                return;
            }

            console.warn(`[QqInboundClient] Retry limit reached for requestId ${message.requestId}`);
        }

        if (message.disposition === "dropped" && message.reason !== "buffer_full") {
            console.warn(
                `[QqInboundClient] Dropped requestId ${message.requestId}; reason ${message.reason ?? "unknown"}, not retrying`,
            );
        }

        this.removePending(message.requestId);
    }

    private scheduleRetry(requestId: string, pending: PendingInput): void {
        const delayMs = INITIAL_RETRY_DELAY_MS * 2 ** pending.retryCount;
        pending.retryCount += 1;
        pending.retryTimer = setTimeout(() => {
            pending.retryTimer = null;
            if (this.pending.get(requestId) !== pending || this.closed) return;

            if (this.isConnected()) {
                this.sendPending(requestId, pending);
            } else {
                this.enqueuePending(requestId);
            }
        }, delayMs);
    }

    private flushQueue(): void {
        while (this.isConnected() && this.queuedRequestIds.length > 0) {
            const requestId = this.queuedRequestIds.shift();
            if (!requestId) continue;

            const pending = this.pending.get(requestId);
            if (!pending) continue;
            pending.queued = false;
            if (!this.sendPending(requestId, pending)) break;
        }
    }

    private sendPending(requestId: string, pending: PendingInput): boolean {
        if (!this.isConnected() || !this.socket) {
            this.enqueuePending(requestId);
            return false;
        }

        let payload: string;
        try {
            payload = serializeClientMessage({ type: "input", event: pending.event, requestId });
        } catch (error) {
            this.removePending(requestId);
            console.error("[QqInboundClient] Failed to serialize input:", errorName(error));
            return false;
        }

        try {
            this.socket.send(payload);
            return true;
        } catch (error) {
            pending.queued = false;
            this.enqueuePending(requestId);
            this.handleSocketFailure(this.socket, error);
            return false;
        }
    }

    private handleError(socket: WebSocket, error: Error): void {
        if (this.socket !== socket || this.closed) return;

        console.error("[QqInboundClient] WebSocket error:", errorName(error));
        this.handleSocketFailure(socket, error);
    }

    private handleSocketFailure(socket: WebSocket, error: unknown): void {
        if (this.socket !== socket || this.closed) return;

        console.error("[QqInboundClient] Connection failure:", errorName(error));
        this.requeuePending();
        this.scheduleReconnect();
    }

    private handleClose(socket: WebSocket): void {
        if (this.socket !== socket) return;

        this.socket = null;
        this.requeuePending();
        this.scheduleReconnect();
    }

    private scheduleReconnect(): void {
        if (!this.started || this.closed || this.reconnectTimer) return;

        const delayMs = this.reconnectDelayMs;
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.started || this.closed) return;

            const staleSocket = this.socket;
            this.socket = null;
            if (staleSocket) {
                try {
                    staleSocket.close();
                } catch (error) {
                    console.error("[QqInboundClient] Failed to close stale WebSocket:", errorName(error));
                }
            }
            this.connect();
        }, delayMs);
    }

    private requeuePending(): void {
        for (const [requestId, pending] of this.pending) {
            this.clearRetryTimer(pending);
            if (!pending.queued) this.enqueuePending(requestId);
        }
    }

    private addPending(requestId: string, pending: PendingInput): void {
        while (this.pending.size >= MAX_PENDING_INPUTS) {
            const oldestRequestId = this.pending.keys().next().value;
            if (oldestRequestId === undefined) break;
            this.removePending(oldestRequestId);
            console.warn(`[QqInboundClient] Pending input limit reached; dropped requestId ${oldestRequestId}`);
        }

        this.pending.set(requestId, pending);
    }

    private enqueuePending(requestId: string): void {
        const pending = this.pending.get(requestId);
        if (!pending || pending.queued) return;

        if (this.queuedRequestIds.length >= MAX_QUEUED_INPUTS) {
            const droppedRequestId = this.queuedRequestIds.shift();
            if (droppedRequestId !== undefined) {
                this.removePending(droppedRequestId);
                console.warn(`[QqInboundClient] Outbound queue full; dropped requestId ${droppedRequestId}`);
            }
        }

        pending.queued = true;
        this.queuedRequestIds.push(requestId);
    }

    private removePending(requestId: string): void {
        const pending = this.pending.get(requestId);
        if (!pending) return;

        this.clearRetryTimer(pending);
        this.pending.delete(requestId);
    }

    private clearRetryTimer(pending: PendingInput): void {
        if (!pending.retryTimer) return;

        clearTimeout(pending.retryTimer);
        pending.retryTimer = null;
    }

    private clearReconnectTimer(): void {
        if (!this.reconnectTimer) return;

        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.name : "UnknownError";
}
