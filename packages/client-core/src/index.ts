import { applyServerMessage } from "./serverMessage";
import { ClientAction, ClientState } from "./types";

export type {
    ConnectionStatus,
    ChatRole,
    ChatMessage,
    ToolActivity,
    AgentTurnActivity,
    ClientState,
    ClientAction,
} from "./types";
export { CaiCaiWsClient, buildWsUrl, SOCKET_CLOSED, SOCKET_OPEN } from "./transport";
export type { WebSocketFactory, WebSocketLike, WsClientHandlers } from "./transport";
export { selectTimeline } from "./timeline";
export type { TimelineItem } from "./timeline";

export const initialClientState: ClientState = {
    connectionStatus: "idle",
    messages: [],
    activities: [],
    errors: [],
};

export function reduceClientState(state: ClientState, action: ClientAction): ClientState {
    if (action.type === "connection_status") {
        return { ...state, connectionStatus: action.status };
    }

    if (action.type === "local_input") {
        return {
            ...state,
            messages: [
                ...state.messages,
                {
                    id: action.requestId,
                    role: "user",
                    text: action.text,
                    status: "pending",
                    createdAt: action.createdAt,
                },
            ],
        };
    }

    return applyServerMessage(state, action.message, action.receivedAt);
}
