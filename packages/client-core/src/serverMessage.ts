import { ServerMessage } from "@caicaiclaw/protocol";
import { updateActivity, upsertActivity } from "./activities.js";
import { appendAssistantDelta, applyInputAccepted } from "./messages.js";
import { ClientState } from "./types.js";

export function applyServerMessage(state: ClientState, message: ServerMessage, receivedAt: number): ClientState {
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
            return appendAssistantDelta(state, message.turnId, message.text, receivedAt);
        case "reasoning_delta":
            return updateActivity(state, message.turnId, receivedAt, (activity) => ({
                ...activity,
                reasoningText: activity.reasoningText + message.text,
            }));
        case "tool_call_start":
            return updateActivity(state, message.turnId, receivedAt, (activity) => ({
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
            return updateActivity(state, message.turnId, receivedAt, (activity) => ({
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
            return markTurnDone(state, message.turnId, message.createdAt, receivedAt);
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

function markTurnDone(state: ClientState, turnId: string, completedAt: number, receivedAt: number): ClientState {
    return {
        ...updateActivity(state, turnId, receivedAt, (activity) => ({ ...activity, status: "done", completedAt })),
        messages: state.messages.map((message) =>
            message.turnId === turnId && message.role === "assistant" ? { ...message, status: "done" } : message,
        ),
    };
}
