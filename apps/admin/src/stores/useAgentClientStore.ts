"use client";

import {
    buildWsUrl,
    CaiCaiWsClient,
    initialClientState,
    reduceClientState,
    type ClientState,
    type WebSocketFactory,
} from "@caicaiclaw/client-core";
import { WS_PROTOCOL_VERSION } from "@caicaiclaw/protocol";
import { errorMessage } from "@caicaiclaw/utils";
import { create } from "zustand";
import { getOrCreateClientId, setStoredClientId } from "../adapters/ws/clientIdentity";

export type AgentClientStore = ClientState & {
    connect: () => Promise<void>;
    disconnect: () => void;
    sendInput: (text: string) => void;
};

let wsClient: CaiCaiWsClient | undefined;
let connectionRequest: Promise<void> | undefined;
let connectionGeneration = 0;
let shouldConnect = false;
const DEFAULT_WS_URL = "ws://127.0.0.1:8787";
const browserSocketFactory: WebSocketFactory = (url) => new WebSocket(url);

export const useAgentClientStore = create<AgentClientStore>((set) => ({
    ...initialClientState,
    connect: () => {
        shouldConnect = true;
        if (wsClient || connectionRequest) return connectionRequest ?? Promise.resolve();
        const generation = connectionGeneration;
        set((state) => reduceClientState(state, { type: "connection_status", status: "connecting" }));
        const attempt = readAgentConnectionTokens()
            .then(({ token, adminToken }) => {
                if (!shouldConnect || generation !== connectionGeneration) return;
                wsClient = new CaiCaiWsClient(
                    buildWsUrl(process.env.NEXT_PUBLIC_CAICAI_WS_URL ?? DEFAULT_WS_URL, getOrCreateClientId(), {
                        token,
                        adminToken,
                    }),
                    {
                        onOpen: () =>
                            set((state) =>
                                reduceClientState(state, { type: "connection_status", status: "connected" }),
                            ),
                        onClose: () =>
                            set((state) => reduceClientState(state, { type: "connection_status", status: "closed" })),
                        onReconnecting: () =>
                            set((state) =>
                                reduceClientState(state, { type: "connection_status", status: "reconnecting" }),
                            ),
                        onError: (error) =>
                            set((state) => ({
                                ...state,
                                errors: [
                                    ...state.errors,
                                    error instanceof Error ? errorMessage(error) : "WebSocket connection error",
                                ],
                            })),
                        onMessage: (message) => {
                            if (message.type === "hello") setStoredClientId(message.clientId);
                            set((state) =>
                                reduceClientState(state, { type: "server_message", message, receivedAt: Date.now() }),
                            );
                            if (message.type === "hello" && message.protocolVersion !== WS_PROTOCOL_VERSION) {
                                wsClient?.disconnect();
                                wsClient = undefined;
                            }
                        },
                    },
                    browserSocketFactory,
                    { type: "role", role: "admin" },
                );
                wsClient.connect();
            })
            .catch((error: unknown) => {
                if (generation !== connectionGeneration) return;
                set((state) => ({ ...state, errors: [...state.errors, errorMessage(error)] }));
                set((state) => reduceClientState(state, { type: "connection_status", status: "closed" }));
            })
            .finally(() => {
                if (connectionRequest === attempt) connectionRequest = undefined;
                if (shouldConnect && !wsClient && generation !== connectionGeneration) {
                    void useAgentClientStore.getState().connect();
                }
            });
        connectionRequest = attempt;
        return attempt;
    },
    disconnect: () => {
        shouldConnect = false;
        connectionGeneration += 1;
        wsClient?.disconnect();
        wsClient = undefined;
        set((state) => reduceClientState(state, { type: "connection_status", status: "closed" }));
    },
    sendInput: (text: string) => {
        const requestId = crypto.randomUUID();
        set((state) => reduceClientState(state, { type: "local_input", requestId, text, createdAt: Date.now() }));
        try {
            const timestamp = Date.now();
            wsClient?.send({
                type: "input",
                event: {
                    channel: "local",
                    conversationId: "local:default",
                    kind: "chat",
                    text,
                    author: { id: "admin", isSelf: false },
                    occurredAt: timestamp,
                    receivedAt: timestamp,
                },
                requestId,
            });
        } catch (error) {
            set((state) => ({ ...state, errors: [...state.errors, errorMessage(error)] }));
        }
    },
}));

async function readAgentConnectionTokens(): Promise<{ token: string; adminToken: string }> {
    const response = await fetch("/api/agent-auth/connection", { cache: "no-store" });
    const body: unknown = await response.json().catch(() => undefined);
    if (
        !response.ok ||
        typeof body !== "object" ||
        body === null ||
        !("token" in body) ||
        typeof body.token !== "string" ||
        !("adminToken" in body) ||
        typeof body.adminToken !== "string"
    ) {
        throw new Error("无法读取 agent WebSocket 鉴权设置");
    }
    return { token: body.token, adminToken: body.adminToken };
}
