import { type ServerMessage } from "@caicaiclaw/protocol";
import { type RuntimeOutputEvent } from "@caicaiclaw/agent-core";

export function runtimeOutputToServerMessages(event: RuntimeOutputEvent): ServerMessage[] {
    switch (event.type) {
        case "input_dropped":
            return [
                {
                    type: "input_dropped",
                    inputId: event.inputId,
                    event: event.event,
                    reason: event.reason,
                    requestId: event.requestId,
                    createdAt: event.createdAt,
                },
            ];
        case "input_accepted":
            return [
                {
                    type: "input_accepted",
                    turnId: event.turnId,
                    lane: event.lane,
                    event: event.event,
                    requestId: event.requestId,
                    createdAt: event.createdAt,
                },
            ];
        case "turn_start":
            return [{ type: "agent_turn_start", turnId: event.turnId, lane: event.lane, createdAt: event.createdAt }];
        case "assistant_delta":
            return [
                {
                    type: "assistant_message_delta",
                    turnId: event.turnId,
                    lane: event.lane,
                    text: event.text,
                    metadata: event.metadata,
                    target: event.target,
                },
            ];
        case "reasoning_delta":
            return [
                {
                    type: "reasoning_delta",
                    turnId: event.turnId,
                    lane: event.lane,
                    text: event.text,
                    metadata: event.metadata,
                },
            ];
        case "tool_call_start":
            return [
                {
                    type: "tool_call_start",
                    turnId: event.turnId,
                    lane: event.lane,
                    toolCallId: event.toolCallId,
                    name: event.name,
                    args: event.args,
                    createdAt: event.createdAt,
                },
            ];
        case "tool_call_result":
            return [
                {
                    type: "tool_call_result",
                    turnId: event.turnId,
                    lane: event.lane,
                    toolCallId: event.toolCallId,
                    name: event.name,
                    status: event.status,
                    result: event.result,
                    createdAt: event.createdAt,
                },
            ];
        case "error":
            return [{ type: "error", turnId: event.turnId, lane: event.lane, message: safeErrorMessage(event.error) }];
        case "done":
            return [{ type: "agent_turn_done", turnId: event.turnId, lane: event.lane, createdAt: Date.now() }];
    }
}

function safeErrorMessage(error: unknown): string {
    const message = (error instanceof Error ? error.message : String(error))
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .replace(/\s+/g, " ")
        .trim();

    if (!message) return "unknown runtime error";
    return message.length > 2_000 ? `${message.slice(0, 2_000)}...` : message;
}
