"use client";

import { ClientMessage, parseServerMessage, serializeClientMessage, ServerMessage } from "@caicaiclaw/protocol";

export type WsClientHandlers = {
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (error: Event) => void;
    onMessage?: (message: ServerMessage) => void;
};

export class CaiCaiWsClient {
    private socket?: WebSocket;

    constructor(
        private readonly url: string,
        private readonly handlers: WsClientHandlers,
    ) {}

    public connect(): void {
        if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;

        this.socket = new WebSocket(this.url);
        this.socket.addEventListener("open", () => this.handlers.onOpen?.());
        this.socket.addEventListener("close", () => this.handlers.onClose?.());
        this.socket.addEventListener("error", (error) => this.handlers.onError?.(error));
        this.socket.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            this.handlers.onMessage?.(parseServerMessage(event.data));
        });
    }

    public disconnect(): void {
        this.socket?.close();
        this.socket = undefined;
    }

    public send(message: ClientMessage): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error("WebSocket is not connected");
        }

        this.socket.send(serializeClientMessage(message));
    }
}
