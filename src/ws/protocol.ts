import { BaseMessage } from "@langchain/core/messages";
import {
    clientIdSchema,
    errorToMessage,
    isValidClientId,
    JsonObject,
    parseClientMessage,
    ServerMessage,
    serializeServerMessage,
    toJsonObject,
    WS_PROTOCOL_VERSION,
} from "@caicaiclaw/protocol";
import { RuntimeOutputEvent } from "../core/index.js";

export {
    clientIdSchema,
    errorToMessage,
    isValidClientId,
    parseClientMessage,
    serializeServerMessage,
    type ServerMessage,
    WS_PROTOCOL_VERSION,
} from "@caicaiclaw/protocol";

export function runtimeOutputToServerMessages(event: RuntimeOutputEvent): ServerMessage[] {
    switch (event.type) {
        case "input_accepted":
            return [
                {
                    type: "input_accepted",
                    turnId: event.turnId,
                    text: event.text,
                    source: event.source,
                    createdAt: event.createdAt,
                },
            ];
        case "turn_start":
            return [{ type: "agent_turn_start", turnId: event.turnId, createdAt: event.createdAt }];
        case "message": {
            const [message, metadata] = event.chunk;
            return [
                {
                    type: "message",
                    message: serializeBaseMessage(message),
                    metadata: toJsonObject(metadata),
                },
            ];
        }
        case "assistant_delta":
            return [
                {
                    type: "assistant_message_delta",
                    turnId: event.turnId,
                    text: event.text,
                    metadata: event.metadata,
                },
            ];
        case "reasoning_delta":
            return [
                {
                    type: "reasoning_delta",
                    turnId: event.turnId,
                    text: event.text,
                    metadata: event.metadata,
                },
            ];
        case "tool_call_start":
            return [
                {
                    type: "tool_call_start",
                    turnId: event.turnId,
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
                    toolCallId: event.toolCallId,
                    name: event.name,
                    status: event.status,
                    result: event.result,
                    createdAt: event.createdAt,
                },
            ];
        case "error":
            return [{ type: "error", turnId: event.turnId, message: errorToMessage(event.error) }];
        case "done":
            return [
                { type: "agent_turn_done", turnId: event.turnId, createdAt: Date.now() },
                { type: "done" },
            ];
    }
}

function serializeBaseMessage(message: BaseMessage): JsonObject {
    return toJsonObject(message.toDict());
}
