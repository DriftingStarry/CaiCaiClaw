"use client";

import { initialClientState, reduceClientState, ClientState } from "@caicaiclaw/client-core";
import { create } from "zustand";
import { getOrCreateClientId, setStoredClientId } from "../adapters/ws/clientIdentity";
import { buildWsUrl } from "../adapters/ws/config";
import { CaiCaiWsClient } from "../adapters/ws/wsClient";

export type AgentClientStore = ClientState & {
    connect: () => void;
    disconnect: () => void;
    sendInput: (text: string) => void;
};

let wsClient: CaiCaiWsClient | undefined;

export const useAgentClientStore = create<AgentClientStore>((set) => ({
    ...initialClientState,
    connect: () => {
        if (wsClient) return;

        set((state) => reduceClientState(state, { type: "connection_status", status: "connecting" }));
        wsClient = new CaiCaiWsClient(buildWsUrl(getOrCreateClientId()), {
            onOpen: () => set((state) => reduceClientState(state, { type: "connection_status", status: "connected" })),
            onClose: () => {
                wsClient = undefined;
                set((state) => reduceClientState(state, { type: "connection_status", status: "closed" }));
            },
            onError: () =>
                set((state) => ({
                    ...state,
                    errors: [...state.errors, "WebSocket connection error"],
                })),
            onMessage: (message) => {
                if (message.type === "hello") {
                    setStoredClientId(message.clientId);
                }

                set((state) => reduceClientState(state, { type: "server_message", message }));
            },
        });
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
                errors: [...state.errors, error instanceof Error ? error.message : String(error)],
            }));
        }
    },
}));
