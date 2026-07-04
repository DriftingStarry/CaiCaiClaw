"use client";

import { initialClientState, reduceClientState, ClientState } from "@caicaiclaw/client-core";
import { create } from "zustand";
import { getWsUrl } from "../adapters/ws/config.js";
import { CaiCaiWsClient } from "../adapters/ws/wsClient.js";

export type AgentClientStore = ClientState & {
    connect: () => void;
    disconnect: () => void;
    sendInput: (text: string) => void;
};

let wsClient: CaiCaiWsClient | undefined;

export const useAgentClientStore = create<AgentClientStore>((set) => ({
    ...initialClientState,
    connect: () => {
        set((state) => reduceClientState(state, { type: "connection_status", status: "connecting" }));
        wsClient = new CaiCaiWsClient(getWsUrl(), {
            onOpen: () => set((state) => reduceClientState(state, { type: "connection_status", status: "connected" })),
            onClose: () => set((state) => reduceClientState(state, { type: "connection_status", status: "closed" })),
            onError: () =>
                set((state) => ({
                    ...state,
                    errors: [...state.errors, "WebSocket connection error"],
                })),
            onMessage: (message) => set((state) => reduceClientState(state, { type: "server_message", message })),
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
        wsClient?.send({ type: "input", text, source: "web", requestId });
    },
}));
