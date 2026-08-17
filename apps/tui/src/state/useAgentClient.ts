import {
    CaiCaiWsClient,
    ClientState,
    initialClientState,
    reduceClientState,
    WebSocketFactory,
    WebSocketLike,
    buildWsUrl,
} from "@caicaiclaw/client-core";
import { WS_PROTOCOL_VERSION } from "@caicaiclaw/protocol";
import { errorMessage } from "@caicaiclaw/utils";
import { randomUUID } from "node:crypto";
import { useEffect, useReducer, useRef } from "react";

export type AgentClient = ClientState & { sendInput: (text: string) => void; reportError: (message: string) => void };

export function useAgentClient(url: string, token = ""): AgentClient {
    const [state, dispatch] = useReducer(reduceClientState, initialClientState);
    const clientId = useRef<string | undefined>(undefined);
    if (!clientId.current) clientId.current = `tui-${randomUUID()}`;
    const clientRef = useRef<CaiCaiWsClient | undefined>(undefined);

    useEffect(() => {
        const socketFactory: WebSocketFactory = createNodeSocket;
        dispatch({ type: "connection_status", status: "connecting" });
        let client: CaiCaiWsClient | undefined;
        try {
            client = new CaiCaiWsClient(
                buildWsUrl(url, clientId.current, token),
                {
                    onOpen: () => dispatch({ type: "connection_status", status: "connected" }),
                    onClose: () => dispatch({ type: "connection_status", status: "closed" }),
                    onReconnecting: () => dispatch({ type: "connection_status", status: "reconnecting" }),
                    onError: (error) =>
                        dispatch({
                            type: "server_message",
                            message: {
                                type: "error",
                                message: error instanceof Error ? errorMessage(error) : errorMessageFromUnknown(error),
                            },
                            receivedAt: Date.now(),
                        }),
                    onMessage: (message) => {
                        // Reducer purity requires timestamps to be injected at this IO boundary.
                        dispatch({ type: "server_message", message, receivedAt: Date.now() });

                        // The reducer can only record the mismatch; tearing down the socket is this
                        // boundary's job. Reconnecting cannot fix a version gap, so stop for good.
                        if (message.type === "hello" && message.protocolVersion !== WS_PROTOCOL_VERSION) {
                            client?.disconnect();
                            dispatch({ type: "connection_status", status: "closed" });
                            clientRef.current = undefined;
                        }
                    },
                },
                socketFactory,
            );
        } catch (error) {
            dispatch({
                type: "server_message",
                message: { type: "error", message: errorMessageFromUnknown(error) },
                receivedAt: Date.now(),
            });
            dispatch({ type: "connection_status", status: "closed" });
            return;
        }
        clientRef.current = client;
        try {
            client.connect();
        } catch (error) {
            client.disconnect();
            clientRef.current = undefined;
            dispatch({
                type: "server_message",
                message: { type: "error", message: errorMessageFromUnknown(error) },
                receivedAt: Date.now(),
            });
            dispatch({ type: "connection_status", status: "closed" });
            return;
        }
        return () => {
            client.disconnect();
            dispatch({ type: "connection_status", status: "closed" });
            if (clientRef.current === client) clientRef.current = undefined;
        };
    }, [url, token]);

    return {
        ...state,
        sendInput: (text: string) => {
            const requestId = randomUUID();
            dispatch({ type: "local_input", requestId, text, createdAt: Date.now() });
            try {
                if (!clientRef.current) throw new Error("WebSocket client is not available");
                clientRef.current.send({ type: "input", text, source: "tui", requestId });
            } catch (error) {
                dispatch({
                    type: "server_message",
                    message: { type: "error", message: errorMessage(error) },
                    receivedAt: Date.now(),
                });
            }
        },
        reportError: (message) =>
            dispatch({ type: "server_message", message: { type: "error", message }, receivedAt: Date.now() }),
    };
}

function errorMessageFromUnknown(error: unknown): string {
    if (typeof error === "object" && error !== null) {
        const candidate = error as { error?: unknown; message?: unknown };
        if (typeof candidate.error === "string") return candidate.error;
        if (typeof candidate.message === "string") return candidate.message;
    }
    return "WebSocket connection error";
}

function createNodeSocket(url: string): WebSocketLike {
    const constructor = (globalThis as { WebSocket?: unknown }).WebSocket;
    if (typeof constructor !== "function") throw new Error("WebSocket is unavailable in this Node runtime");
    return new (constructor as new (socketUrl: string) => unknown)(url) as WebSocketLike;
}
