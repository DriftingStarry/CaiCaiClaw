"use client";

import {
    buildWsUrl,
    CaiCaiWsClient,
    initialClientState,
    reduceClientState,
    ClientState,
    WebSocketFactory,
} from "@caicaiclaw/client-core";
import { WS_PROTOCOL_VERSION } from "@caicaiclaw/protocol";
import { errorMessage } from "@caicaiclaw/utils";
import { create } from "zustand";
import { getOrCreateClientId, setStoredClientId } from "../adapters/ws/clientIdentity";

export type AgentClientStore = ClientState & {
    connect: () => void;
    disconnect: () => void;
    sendInput: (text: string) => void;
};

let wsClient: CaiCaiWsClient | undefined;

const DEFAULT_WS_URL = "ws://127.0.0.1:8787";

function getWsUrl(): string {
    return process.env.NEXT_PUBLIC_CAICAI_WS_URL ?? DEFAULT_WS_URL;
}

const browserSocketFactory: WebSocketFactory = (url) => new WebSocket(url);

export const useAgentClientStore = create<AgentClientStore>((set) => ({
    ...initialClientState,
    connect: () => {
        if (wsClient) return;

        set((state) => reduceClientState(state, { type: "connection_status", status: "connecting" }));
        wsClient = new CaiCaiWsClient(
            buildWsUrl(getWsUrl(), getOrCreateClientId()),
            {
                onOpen: () =>
                    set((state) => reduceClientState(state, { type: "connection_status", status: "connected" })),
                onClose: () => {
                    set((state) => reduceClientState(state, { type: "connection_status", status: "closed" }));
                },
                onReconnecting: () =>
                    set((state) => reduceClientState(state, { type: "connection_status", status: "reconnecting" })),
                onError: (error) =>
                    set((state) => ({
                        ...state,
                        errors: [
                            ...state.errors,
                            error instanceof Error ? errorMessage(error) : "WebSocket connection error",
                        ],
                    })),
                onMessage: (message) => {
                    if (message.type === "hello") {
                        setStoredClientId(message.clientId);
                    }

                    // Reducer purity requires timestamps to be injected at this IO boundary.
                    set((state) =>
                        reduceClientState(state, { type: "server_message", message, receivedAt: Date.now() }),
                    );

                    // The reducer can only record the mismatch; tearing down the socket is this
                    // boundary's job. Reconnecting cannot fix a version gap, so stop for good.
                    if (message.type === "hello" && message.protocolVersion !== WS_PROTOCOL_VERSION) {
                        wsClient?.disconnect();
                        wsClient = undefined;
                    }
                },
            },
            browserSocketFactory,
        );
        wsClient.connect();
    },
    disconnect: () => {
        wsClient?.disconnect();
        wsClient = undefined;
        set((state) => reduceClientState(state, { type: "connection_status", status: "closed" }));
    },
    sendInput: (text: string) => {
        const requestId = crypto.randomUUID();
        set((state) => reduceClientState(state, { type: "local_input", requestId, text, createdAt: Date.now() }));
        try {
            wsClient?.send({ type: "input", text, source: "web", requestId });
        } catch (error) {
            set((state) => ({
                ...state,
                errors: [...state.errors, errorMessage(error)],
            }));
        }
    },
}));
