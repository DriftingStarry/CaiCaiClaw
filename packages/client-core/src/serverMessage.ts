import { ServerMessage, WS_PROTOCOL_VERSION } from "@caicaiclaw/protocol";
import { updateActivity, upsertActivity } from "./activities";
import { appendAssistantDelta, applyInputAccepted } from "./messages";
import { ClientState } from "./types";

export function applyServerMessage(state: ClientState, message: ServerMessage, receivedAt: number): ClientState {
    switch (message.type) {
        case "hello":
            if (message.protocolVersion === WS_PROTOCOL_VERSION) {
                return { ...state, connectionStatus: "connected", clientId: message.clientId };
            }
            return {
                ...state,
                connectionStatus: "closed",
                clientId: message.clientId,
                errors: [...state.errors, protocolVersionMismatch(message.protocolVersion)],
            };
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
        case "lane_snapshot":
            // 快照是全量替换语义，不是增量合并。
            return {
                ...state,
                laneSnapshot: {
                    createdAt: message.createdAt,
                    lanes: message.lanes,
                },
            };
        case "intake_snapshot":
            // 快照是全量替换语义，不是增量合并。
            return {
                ...state,
                intakeSnapshot: {
                    createdAt: message.createdAt,
                    conversations: message.conversations,
                    policies: message.policies,
                },
            };
        case "channel_snapshot":
            // 快照是全量替换语义，不是增量合并。
            return {
                ...state,
                channelSnapshot: {
                    createdAt: message.createdAt,
                    channels: message.channels,
                    tools: message.tools,
                    inboundRates: message.inboundRates,
                    outbound: message.outbound,
                },
            };
        case "approval_snapshot":
            // 快照是全量替换语义，不是增量合并。
            return {
                ...state,
                approvalSnapshot: {
                    createdAt: message.createdAt,
                    pending: message.pending,
                    decided: message.decided,
                },
            };
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

function protocolVersionMismatch(serverVersion: number): string {
    return `protocol version mismatch: server ${serverVersion}, client ${WS_PROTOCOL_VERSION}`;
}

function markTurnDone(state: ClientState, turnId: string, completedAt: number, receivedAt: number): ClientState {
    return {
        ...updateActivity(state, turnId, receivedAt, (activity) => ({ ...activity, status: "done", completedAt })),
        messages: state.messages.map((message) =>
            message.turnId === turnId && message.role === "assistant" ? { ...message, status: "done" } : message,
        ),
    };
}
