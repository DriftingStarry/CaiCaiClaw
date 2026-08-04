import { z } from "zod";
import type { JsonObject, JsonValue } from "@caicaiclaw/tool";

export { errorMessage, isJsonObject, toJsonObject, toJsonValue } from "@caicaiclaw/tool";
export { errorMessage as errorToMessage } from "@caicaiclaw/tool";
export type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from "@caicaiclaw/tool";

export const WS_PROTOCOL_VERSION = 2;
export const MAX_CLIENT_ID_LENGTH = 64;
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const requestIdSchema = z.string().min(1).optional();
export const clientIdSchema = z.string().min(1).max(MAX_CLIENT_ID_LENGTH).regex(CLIENT_ID_PATTERN);

export const clientInputMessageSchema = z.object({
    type: z.literal("input"),
    text: z.string().trim().min(1),
    source: z.string().trim().min(1).optional(),
    requestId: requestIdSchema,
});

export const clientPingMessageSchema = z.object({
    type: z.literal("ping"),
    requestId: requestIdSchema,
});

export const clientMessageSchema = z.discriminatedUnion("type", [
    clientInputMessageSchema,
    clientPingMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type StoredMessagePayload = JsonObject;

export type ServerMessage =
    | {
          type: "hello";
          protocolVersion: number;
          clientId: string;
      }
    | {
          type: "ack";
          requestId?: string;
      }
    | {
          type: "input_accepted";
          turnId: string;
          text: string;
          source?: string;
          createdAt: number;
      }
    | {
          type: "agent_turn_start";
          turnId: string;
          createdAt: number;
      }
    | {
          type: "assistant_message_delta";
          turnId: string;
          text: string;
          metadata: JsonObject;
      }
    | {
          type: "reasoning_delta";
          turnId: string;
          text: string;
          metadata: JsonObject;
      }
    | {
          type: "tool_call_start";
          turnId: string;
          toolCallId: string;
          name: string;
          args: JsonObject;
          createdAt: number;
      }
    | {
          type: "tool_call_result";
          turnId: string;
          toolCallId: string;
          name: string;
          status: "success" | "error";
          result: JsonValue;
          createdAt: number;
      }
    | {
          type: "agent_turn_done";
          turnId: string;
          createdAt: number;
      }
    | {
          type: "message";
          message: StoredMessagePayload;
          metadata: JsonObject;
      }
    | {
          type: "done";
      }
    | {
          type: "error";
          message: string;
          requestId?: string;
          turnId?: string;
      }
    | {
          type: "pong";
          requestId?: string;
      };

export function parseClientMessage(raw: string): ClientMessage {
    let data: unknown;

    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error("message must be valid JSON");
    }

    const parsed = clientMessageSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(z.prettifyError(parsed.error));
    }

    return parsed.data;
}

export function parseServerMessage(raw: string): ServerMessage {
    let data: unknown;

    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error("message must be valid JSON");
    }

    return data as ServerMessage;
}

export function serializeClientMessage(message: ClientMessage): string {
    return JSON.stringify(message);
}

export function serializeServerMessage(message: ServerMessage): string {
    return JSON.stringify(message);
}

export function isValidClientId(value: unknown): value is string {
    return clientIdSchema.safeParse(value).success;
}
