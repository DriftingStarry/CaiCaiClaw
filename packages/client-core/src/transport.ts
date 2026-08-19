import {
    ClientMessage,
    ClientRoleMessage,
    parseServerMessage,
    serializeClientMessage,
    ServerMessage,
} from "@caicaiclaw/protocol";

export type WebSocketLike = {
    readyState: number;
    send(data: string): void;
    close(): void;
    addEventListener(type: string, listener: (event: unknown) => void): void;
};

export type WebSocketFactory = (url: string) => WebSocketLike;

export type WsClientHandlers = {
    onOpen?: () => void;
    onClose?: () => void;
    onReconnecting?: (attempt: number) => void;
    onError?: (error: unknown) => void;
    onMessage?: (message: ServerMessage) => void;
};

export const SOCKET_OPEN = 1;
export const SOCKET_CLOSED = 3;

const INITIAL_RECONNECT_DELAY_MS = 500;
// A 30-second ceiling keeps recovery attempts alive without hammering an unavailable server.
const MAX_RECONNECT_DELAY_MS = 30_000;

export class CaiCaiWsClient {
    private socket?: WebSocketLike;
    private reconnectAttempt = 0;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    // Explicit close intent prevents a user disconnect from being mistaken for a recoverable outage.
    private intentionallyClosed = false;

    constructor(
        private readonly url: string,
        private readonly handlers: WsClientHandlers,
        private readonly createSocket: WebSocketFactory,
        private readonly role: ClientRoleMessage = { type: "role", role: "observer" },
    ) {}

    public connect(): void {
        if (this.socket && this.socket.readyState !== SOCKET_CLOSED) return;

        this.intentionallyClosed = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }

        const socket = this.createSocket(this.url);
        this.socket = socket;
        socket.addEventListener("open", () => {
            if (this.socket !== socket) return;

            this.reconnectAttempt = 0;
            socket.send(serializeClientMessage(this.role));
            this.handlers.onOpen?.();
        });
        socket.addEventListener("close", () => {
            if (this.socket !== socket) return;

            this.handlers.onClose?.();
            this.scheduleReconnect();
        });
        socket.addEventListener("error", (error) => {
            if (this.socket !== socket) return;

            this.handlers.onError?.(error);
            // Some runtimes fire error without a follow-up close on a failed handshake,
            // which would otherwise end the reconnect chain here.
            this.scheduleReconnect();
        });
        socket.addEventListener("message", (event) => {
            if (!isMessageEvent(event) || typeof event.data !== "string") return;

            try {
                const message = parseServerMessage(event.data);
                if (!message) return;
                this.handlers.onMessage?.(message);
            } catch (error) {
                this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    /** Both close and error can trigger recovery; the pending timer keeps one outage to one attempt. */
    private scheduleReconnect(): void {
        if (this.intentionallyClosed || this.reconnectTimer) return;

        this.reconnectAttempt += 1;
        const attempt = this.reconnectAttempt;
        const delay = Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            // A socket stuck in CONNECTING would make connect()'s guard bail out, so drop it first.
            // Detach the reference before closing: close() can fire error synchronously, and a live
            // reference would let that error schedule a second attempt.
            const staleSocket = this.socket;
            this.socket = undefined;
            staleSocket?.close();
            this.connect();
        }, delay);
        this.handlers.onReconnecting?.(attempt);
    }

    public disconnect(): void {
        this.intentionallyClosed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }

        this.socket?.close();
        this.socket = undefined;
    }

    public send(message: ClientMessage): void {
        if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
            throw new Error("WebSocket is not connected");
        }

        this.socket.send(serializeClientMessage(message));
    }
}

function isMessageEvent(event: unknown): event is { data: unknown } {
    return typeof event === "object" && event !== null && "data" in event;
}

export function buildWsUrl(baseUrl: string, clientId?: string, token?: string): string {
    const url = new URL(baseUrl);

    if (clientId) {
        url.searchParams.set("clientId", clientId);
    }
    if (token) {
        url.searchParams.set("token", token);
    }

    return url.toString();
}
