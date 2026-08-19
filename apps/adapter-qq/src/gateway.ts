import WebSocket from "ws";
import type { RawData } from "ws";

import { TokenManager } from "./token-manager";

export interface QqGatewayOptions {
    tokenManager: TokenManager;
    apiBaseUrl: string;
    intents: number;
    onDispatch: (eventType: string, data: unknown) => void;
    onReady: (selfId: string) => void;
    onDisconnected: (reason: string, resumable: boolean) => void;
}

interface GatewayPayload {
    op: number;
    d: unknown;
    s?: number | null;
    t?: string | null;
}

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const INVALID_SESSION_RETRY_DELAY_MS = 1_000;
const CLOSE_CODE_PROTOCOL_ERROR = 1_002;
const CLOSE_CODE_RECONNECT_REQUESTED = 4_000;
const CLOSE_CODE_SESSION_EXPIRED = 4_009;
const CLOSE_CODE_INVALID_SESSION = 4_006;
const CLOSE_CODE_INVALID_SEQUENCE = 4_007;
const CLOSE_CODE_BOT_UNAVAILABLE = 4_914;
const CLOSE_CODE_BOT_BANNED = 4_915;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.name : "UnknownError";
}

export class QqGateway {
    private readonly tokenManager: TokenManager;
    private readonly apiBaseUrl: string;
    private readonly intents: number;
    private readonly onDispatch: (eventType: string, data: unknown) => void;
    private readonly onReady: (selfId: string) => void;
    private readonly onDisconnected: (reason: string, resumable: boolean) => void;

    private socket: WebSocket | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private identifyTimer: NodeJS.Timeout | null = null;
    private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    private sequence: number | null = null;
    private sessionId: string | null = null;
    private connecting = false;
    private reconnectRequested = false;
    private started = false;
    private closed = false;

    constructor(options: QqGatewayOptions) {
        this.tokenManager = options.tokenManager;
        this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
        this.intents = options.intents;
        this.onDispatch = options.onDispatch;
        this.onReady = options.onReady;
        this.onDisconnected = options.onDisconnected;
    }

    start(): void {
        if (this.started || this.closed) {
            return;
        }

        this.started = true;
        void this.connect();
    }

    close(): void {
        if (this.closed) {
            return;
        }

        this.closed = true;
        this.started = false;
        this.clearReconnectTimer();
        this.clearIdentifyTimer();
        this.clearHeartbeatTimer();
        this.sessionId = null;
        this.sequence = null;

        const socket = this.socket;
        if (!socket) {
            return;
        }

        try {
            socket.close(1_000, "Client closed");
        } catch (error) {
            console.error("[QqGateway] Failed to close WebSocket:", errorName(error));
            socket.terminate();
        }
    }

    private async connect(): Promise<void> {
        if (!this.started || this.closed || this.socket || this.connecting) {
            return;
        }

        this.connecting = true;

        try {
            const token = await this.tokenManager.getToken();
            if (!this.started || this.closed) {
                return;
            }

            const gatewayUrl = await this.fetchGatewayUrl(token);
            if (!this.started || this.closed) {
                return;
            }

            const socket = new WebSocket(gatewayUrl);
            this.socket = socket;
            this.bindSocketEvents(socket);
        } catch (error) {
            console.error("[QqGateway] Failed to establish connection:", error);
            this.scheduleReconnect();
        } finally {
            this.connecting = false;
        }
    }

    private async fetchGatewayUrl(token: string): Promise<string> {
        const response = await fetch(`${this.apiBaseUrl}/gateway`, {
            headers: {
                Authorization: `QQBot ${token}`,
            },
        });

        if (!response.ok) {
            const responseBody = (await response.text()).slice(0, 500);
            throw new Error(`Gateway request failed with HTTP ${response.status}: ${responseBody}`);
        }

        const data: unknown = await response.json();
        if (!isRecord(data) || typeof data.url !== "string" || data.url.length === 0) {
            throw new Error("Gateway response did not contain a valid url");
        }

        return data.url;
    }

    private bindSocketEvents(socket: WebSocket): void {
        socket.on("open", () => this.handleOpen(socket));
        socket.on("message", (data: RawData) => this.handleMessage(socket, data));
        socket.on("error", (error: Error) => {
            console.error("[QqGateway] WebSocket error:", error);
        });
        socket.on("close", (code: number, reason: Buffer) => this.handleClose(socket, code, reason));
    }

    private handleOpen(socket: WebSocket): void {
        if (this.socket !== socket || this.closed) {
            return;
        }

        this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    }

    private handleMessage(socket: WebSocket, data: RawData): void {
        if (this.socket !== socket || this.closed) {
            return;
        }

        let payload: GatewayPayload;
        try {
            payload = this.parsePayload(this.decodeMessage(data));
        } catch (error) {
            console.error("[QqGateway] Invalid gateway message:", errorName(error));
            this.closeSocketForProtocolError(socket);
            return;
        }

        if (payload.op === 0 && typeof payload.s === "number") {
            this.sequence = payload.s;
        }

        switch (payload.op) {
            case 0:
                this.handleDispatch(payload);
                break;
            case 1:
                break;
            case 7:
                this.handleReconnect(socket);
                break;
            case 9:
                this.handleInvalidSession(socket);
                break;
            case 10:
                this.handleHello(socket, payload.d);
                break;
            case 11:
                break;
            default:
                console.error(`[QqGateway] Unsupported gateway opcode: ${payload.op}`);
                break;
        }
    }

    private parsePayload(message: string): GatewayPayload {
        const parsed: unknown = JSON.parse(message);
        if (!isRecord(parsed) || typeof parsed.op !== "number") {
            throw new Error("Gateway payload is missing a numeric opcode");
        }

        const sequence = parsed.s;
        if (sequence !== undefined && sequence !== null && typeof sequence !== "number") {
            throw new Error("Gateway payload contains an invalid sequence");
        }

        const eventType = parsed.t;
        if (eventType !== undefined && eventType !== null && typeof eventType !== "string") {
            throw new Error("Gateway payload contains an invalid event type");
        }

        return {
            op: parsed.op,
            d: parsed.d,
            s: sequence,
            t: eventType,
        };
    }

    private decodeMessage(data: RawData): string {
        if (data instanceof ArrayBuffer) {
            return new TextDecoder().decode(new Uint8Array(data));
        }

        if (Array.isArray(data)) {
            return Buffer.concat(data).toString("utf8");
        }

        return data.toString("utf8");
    }

    private handleHello(socket: WebSocket, data: unknown): void {
        if (!isRecord(data) || typeof data.heartbeat_interval !== "number" || data.heartbeat_interval <= 0) {
            console.error("[QqGateway] Hello message contains an invalid heartbeat interval");
            this.closeSocketForProtocolError(socket);
            return;
        }

        this.clearHeartbeatTimer();
        this.heartbeatTimer = setInterval(() => this.sendHeartbeat(socket), data.heartbeat_interval);
        void this.sendIdentifyOrResume(socket);
    }

    private handleDispatch(payload: GatewayPayload): void {
        if (payload.t === "READY") {
            this.handleReady(payload.d);
            return;
        }

        if (payload.t === "RESUMED") {
            return;
        }

        if (typeof payload.t !== "string") {
            console.error("[QqGateway] Dispatch message is missing an event type");
            return;
        }

        try {
            this.onDispatch(payload.t, payload.d);
        } catch (error) {
            console.error("[QqGateway] onDispatch callback failed:", errorName(error));
        }
    }

    private handleReady(data: unknown): void {
        if (
            !isRecord(data) ||
            typeof data.session_id !== "string" ||
            !isRecord(data.user) ||
            typeof data.user.id !== "string"
        ) {
            console.error("[QqGateway] READY message contains invalid session or user data");
            return;
        }

        this.sessionId = data.session_id;

        try {
            this.onReady(data.user.id);
        } catch (error) {
            console.error("[QqGateway] onReady callback failed:", errorName(error));
        }
    }

    private handleReconnect(socket: WebSocket): void {
        this.reconnectRequested = true;
        this.clearHeartbeatTimer();

        try {
            socket.close(CLOSE_CODE_RECONNECT_REQUESTED, "Reconnect requested");
        } catch (error) {
            console.error("[QqGateway] Failed to request WebSocket reconnect:", errorName(error));
            socket.terminate();
        }
    }

    private handleInvalidSession(socket: WebSocket): void {
        this.sessionId = null;
        this.sequence = null;
        this.clearIdentifyTimer();
        this.identifyTimer = setTimeout(() => {
            this.identifyTimer = null;
            void this.sendIdentify(socket);
        }, INVALID_SESSION_RETRY_DELAY_MS);
    }

    private async sendIdentifyOrResume(socket: WebSocket): Promise<void> {
        if (this.sessionId) {
            await this.sendResume(socket);
            return;
        }

        await this.sendIdentify(socket);
    }

    private async sendIdentify(socket: WebSocket): Promise<void> {
        try {
            const token = await this.tokenManager.getToken();
            if (this.socket !== socket || this.closed || socket.readyState !== WebSocket.OPEN) {
                return;
            }

            this.send(socket, {
                op: 2,
                d: {
                    token: `QQBot ${token}`,
                    intents: this.intents,
                    shard: [0, 1],
                    properties: {},
                },
            });
        } catch (error) {
            console.error("[QqGateway] Failed to send Identify:", errorName(error));
            this.closeSocketForFailure(socket);
        }
    }

    private async sendResume(socket: WebSocket): Promise<void> {
        try {
            const token = await this.tokenManager.getToken();
            if (this.socket !== socket || this.closed || socket.readyState !== WebSocket.OPEN || !this.sessionId) {
                return;
            }

            this.send(socket, {
                op: 6,
                d: {
                    token: `QQBot ${token}`,
                    session_id: this.sessionId,
                    seq: this.sequence,
                },
            });
        } catch (error) {
            console.error("[QqGateway] Failed to send Resume:", errorName(error));
            this.closeSocketForFailure(socket);
        }
    }

    private sendHeartbeat(socket: WebSocket): void {
        if (this.socket !== socket || this.closed || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            this.send(socket, { op: 1, d: this.sequence });
        } catch (error) {
            console.error("[QqGateway] Failed to send heartbeat:", errorName(error));
            this.closeSocketForFailure(socket);
        }
    }

    private send(socket: WebSocket, payload: { op: number; d: unknown }): void {
        socket.send(JSON.stringify(payload), (error?: Error) => {
            if (!error) {
                return;
            }

            console.error("[QqGateway] WebSocket send failed:", errorName(error));
            if (this.socket === socket && !this.closed) {
                this.closeSocketForFailure(socket);
            }
        });
    }

    private handleClose(socket: WebSocket, code: number, reason: Buffer): void {
        if (this.socket !== socket) {
            return;
        }

        this.socket = null;
        this.clearHeartbeatTimer();
        this.clearIdentifyTimer();

        const requestedReconnect = this.reconnectRequested;
        this.reconnectRequested = false;
        const resumable = requestedReconnect || code === CLOSE_CODE_SESSION_EXPIRED;
        const closeReason = reason.toString("utf8").trim() || `WebSocket closed with code ${code}`;

        this.notifyDisconnected(closeReason, resumable);

        if (this.closed || !this.started) {
            return;
        }

        if (code === CLOSE_CODE_BOT_UNAVAILABLE || code === CLOSE_CODE_BOT_BANNED) {
            this.started = false;
            this.closed = true;
            this.sessionId = null;
            this.sequence = null;
            console.error(`[QqGateway] Reconnection disabled after WebSocket close code ${code}`);
            return;
        }

        if (code !== CLOSE_CODE_SESSION_EXPIRED && code !== CLOSE_CODE_RECONNECT_REQUESTED) {
            this.sessionId = null;
            this.sequence = null;
        }

        if (code === CLOSE_CODE_INVALID_SESSION || code === CLOSE_CODE_INVALID_SEQUENCE) {
            this.sessionId = null;
            this.sequence = null;
        }

        this.scheduleReconnect();
    }

    private closeSocketForProtocolError(socket: WebSocket): void {
        try {
            socket.close(CLOSE_CODE_PROTOCOL_ERROR, "Invalid gateway payload");
        } catch (error) {
            console.error("[QqGateway] Failed to close invalid WebSocket:", errorName(error));
            socket.terminate();
        }
    }

    private closeSocketForFailure(socket: WebSocket): void {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            try {
                socket.close();
            } catch (error) {
                console.error("[QqGateway] Failed to close failed WebSocket:", errorName(error));
                socket.terminate();
            }
        }
    }

    private scheduleReconnect(): void {
        if (!this.started || this.closed || this.reconnectTimer) {
            return;
        }

        const delay = this.reconnectDelayMs;
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect();
        }, delay);
    }

    private notifyDisconnected(reason: string, resumable: boolean): void {
        try {
            this.onDisconnected(reason, resumable);
        } catch (error) {
            console.error("[QqGateway] onDisconnected callback failed:", errorName(error));
        }
    }

    private clearHeartbeatTimer(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private clearIdentifyTimer(): void {
        if (this.identifyTimer) {
            clearTimeout(this.identifyTimer);
            this.identifyTimer = null;
        }
    }
}
