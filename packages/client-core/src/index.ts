import { JsonObject, JsonValue, ServerMessage } from "@caicaiclaw/protocol";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
    id: string;
    role: ChatRole;
    turnId?: string;
    text: string;
    status: "pending" | "streaming" | "done" | "error";
    createdAt: number;
};

export type ToolActivity = {
    id: string;
    turnId: string;
    name: string;
    args: JsonObject;
    status: "running" | "success" | "error";
    result?: JsonValue;
    createdAt: number;
    completedAt?: number;
};

export type AgentTurnActivity = {
    turnId: string;
    status: "running" | "done" | "error";
    reasoningText: string;
    tools: ToolActivity[];
    startedAt: number;
    completedAt?: number;
};

export type ClientState = {
    connectionStatus: ConnectionStatus;
    clientId?: string;
    messages: ChatMessage[];
    activities: AgentTurnActivity[];
    errors: string[];
};

export type ClientAction =
    | {
          type: "connection_status";
          status: ConnectionStatus;
      }
    | {
          type: "local_input";
          requestId: string;
          text: string;
          createdAt: number;
      }
    | {
          type: "server_message";
          message: ServerMessage;
      };

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

    return applyServerMessage(state, action.message);
}

function applyServerMessage(state: ClientState, message: ServerMessage): ClientState {
    switch (message.type) {
        case "hello":
            return { ...state, connectionStatus: "connected", clientId: message.clientId };
        case "input_accepted":
            return applyInputAccepted(state, message);
        case "agent_turn_start":
            return upsertActivity(state, {
                turnId: message.turnId,
                status: "running",
                reasoningText: "",
                tools: [],
                startedAt: message.createdAt,
            });
        case "assistant_message_delta":
            return appendAssistantDelta(state, message.turnId, message.text);
        case "reasoning_delta":
            return updateActivity(state, message.turnId, (activity) => ({
                ...activity,
                reasoningText: activity.reasoningText + message.text,
            }));
        case "tool_call_start":
            return updateActivity(state, message.turnId, (activity) => ({
                ...activity,
                tools: [
                    ...activity.tools,
                    {
                        id: message.toolCallId,
                        turnId: message.turnId,
                        name: message.name,
                        args: message.args,
                        status: "running",
                        createdAt: message.createdAt,
                    },
                ],
            }));
        case "tool_call_result":
            return updateActivity(state, message.turnId, (activity) => ({
                ...activity,
                tools: activity.tools.map((tool) =>
                    tool.id === message.toolCallId
                        ? {
                              ...tool,
                              status: message.status,
                              result: message.result,
                              completedAt: message.createdAt,
                          }
                        : tool,
                ),
            }));
        case "agent_turn_done":
            return markTurnDone(state, message.turnId, message.createdAt);
        case "error":
            return {
                ...state,
                errors: [...state.errors, message.message],
                activities: message.turnId
                    ? state.activities.map((activity) =>
                          activity.turnId === message.turnId ? { ...activity, status: "error" } : activity,
                      )
                    : state.activities,
            };
        default:
            return state;
    }
}

function applyInputAccepted(
    state: ClientState,
    message: Extract<ServerMessage, { type: "input_accepted" }>,
): ClientState {
    const existing = state.messages.find((item) => item.role === "user" && item.text === message.text && item.status === "pending");
    if (existing) {
        return {
            ...state,
            messages: state.messages.map((item) =>
                item.id === existing.id
                    ? { ...item, turnId: message.turnId, status: "done", createdAt: message.createdAt }
                    : item,
            ),
        };
    }

    return {
        ...state,
        messages: [
            ...state.messages,
            {
                id: `${message.turnId}:user`,
                role: "user",
                turnId: message.turnId,
                text: message.text,
                status: "done",
                createdAt: message.createdAt,
            },
        ],
    };
}

function appendAssistantDelta(state: ClientState, turnId: string, text: string): ClientState {
    const id = `${turnId}:assistant`;
    const existing = state.messages.find((item) => item.id === id);

    if (!existing) {
        return {
            ...state,
            messages: [
                ...state.messages,
                {
                    id,
                    role: "assistant",
                    turnId,
                    text,
                    status: "streaming",
                    createdAt: Date.now(),
                },
            ],
        };
    }

    return {
        ...state,
        messages: state.messages.map((item) => (item.id === id ? { ...item, text: item.text + text } : item)),
    };
}

function markTurnDone(state: ClientState, turnId: string, completedAt: number): ClientState {
    return {
        ...updateActivity(state, turnId, (activity) => ({ ...activity, status: "done", completedAt })),
        messages: state.messages.map((message) =>
            message.turnId === turnId && message.role === "assistant" ? { ...message, status: "done" } : message,
        ),
    };
}

function upsertActivity(state: ClientState, activity: AgentTurnActivity): ClientState {
    if (state.activities.some((item) => item.turnId === activity.turnId)) {
        return updateActivity(state, activity.turnId, () => activity);
    }

    return { ...state, activities: [...state.activities, activity] };
}

function updateActivity(
    state: ClientState,
    turnId: string,
    update: (activity: AgentTurnActivity) => AgentTurnActivity,
): ClientState {
    const existing = state.activities.find((activity) => activity.turnId === turnId);
    const activity =
        existing ??
        ({
            turnId,
            status: "running",
            reasoningText: "",
            tools: [],
            startedAt: Date.now(),
        } satisfies AgentTurnActivity);

    if (!existing) {
        return { ...state, activities: [...state.activities, update(activity)] };
    }

    return {
        ...state,
        activities: state.activities.map((item) => (item.turnId === turnId ? update(item) : item)),
    };
}
