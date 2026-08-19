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

export type DebugReceipt = {
    requestId: string;
    kind: "input";
    label: string;
    disposition?: "accepted" | "merged" | "dropped";
    reason?: string;
    batchId?: string;
    error?: string;
    createdAt: number;
};

export type InjectEventDraft = {
    channel: string;
    conversationId: string;
    kind: string;
    text: string;
    authorId: string;
    isSelf: boolean;
    platformMessageId?: string;
    laneHint?: "fast" | "deep";
};

export type AgentClientStore = ClientState & {
    connect: () => Promise<void>;
    disconnect: () => void;
    sendInput: (text: string) => void;
    decideApproval: (approvalId: string, decision: "approve" | "deny") => void;
    debugReceipts: DebugReceipt[];
    injectEvent: (draft: InjectEventDraft) => void;
};

let wsClient: CaiCaiWsClient | undefined;
let connectionRequest: Promise<void> | undefined;
let connectionGeneration = 0;
let shouldConnect = false;
const DEFAULT_WS_URL = "ws://127.0.0.1:8787";
const browserSocketFactory: WebSocketFactory = (url) => new WebSocket(url);

export const useAgentClientStore = create<AgentClientStore>((set) => ({
    ...initialClientState,
    debugReceipts: [],
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
                            // 回执按 requestId 回填；未命中调试回执的 ack/error 不动状态（例如 chat 输入的 ack）。
                            if (message.type === "ack" && message.requestId) {
                                const requestId = message.requestId;
                                set((state) =>
                                    patchDebugReceipt(state, requestId, {
                                        ...(message.disposition ? { disposition: message.disposition } : {}),
                                        ...(message.reason ? { reason: message.reason } : {}),
                                        ...(message.batchId ? { batchId: message.batchId } : {}),
                                    }),
                                );
                            }
                            if (message.type === "error" && message.requestId) {
                                const requestId = message.requestId;
                                set((state) => patchDebugReceipt(state, requestId, { error: message.message }));
                            }
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
    decideApproval: (approvalId: string, decision: "approve" | "deny") => {
        const requestId = crypto.randomUUID();
        try {
            wsClient?.send({ type: "approval_decision", approvalId, decision, requestId });
        } catch (error) {
            set((state) => ({ ...state, errors: [...state.errors, errorMessage(error)] }));
        }
    },
    injectEvent: (draft: InjectEventDraft) => {
        const requestId = crypto.randomUUID();
        const timestamp = Date.now();
        const receipt: DebugReceipt = {
            requestId,
            kind: "input",
            label: `${draft.channel}/${draft.conversationId}`,
            createdAt: timestamp,
        };
        set((state) => ({
            ...state,
            debugReceipts: [...state.debugReceipts, receipt].slice(-MAX_DEBUG_RECEIPTS),
        }));

        // 未连接时 send 是静默 no-op，回执会永远停在「等待回执」，因此这里显式回填错误。
        if (!wsClient) {
            set((state) => patchDebugReceipt(state, requestId, { error: "WebSocket 未连接，事件未发送" }));
            return;
        }

        try {
            wsClient.send({
                type: "input",
                event: {
                    channel: draft.channel,
                    conversationId: draft.conversationId,
                    kind: draft.kind,
                    text: draft.text,
                    // debugOrigin 不由客户端设置：服务端按连接角色强制标记。
                    author: { id: draft.authorId, isSelf: draft.isSelf },
                    occurredAt: timestamp,
                    receivedAt: timestamp,
                    ...(draft.platformMessageId ? { platformMessageId: draft.platformMessageId } : {}),
                    ...(draft.laneHint ? { laneHint: draft.laneHint } : {}),
                },
                requestId,
            });
        } catch (error) {
            set((state) => patchDebugReceipt(state, requestId, { error: errorMessage(error) }));
        }
    },
}));

const MAX_DEBUG_RECEIPTS = 20;

/** 按 requestId 回填调试回执；未命中时原样返回，避免无关 ack/error 触发重渲染。 */
function patchDebugReceipt(state: AgentClientStore, requestId: string, patch: Partial<DebugReceipt>): AgentClientStore {
    if (!state.debugReceipts.some((receipt) => receipt.requestId === requestId)) return state;
    return {
        ...state,
        debugReceipts: state.debugReceipts.map((receipt) =>
            receipt.requestId === requestId ? { ...receipt, ...patch } : receipt,
        ),
    };
}

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
