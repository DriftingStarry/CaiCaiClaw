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
