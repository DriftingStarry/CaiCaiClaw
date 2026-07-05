import { z } from "zod/v4";

export const WS_PROTOCOL_VERSION = 2;
export const MAX_CLIENT_ID_LENGTH = 64;
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

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

export function toJsonObject(value: unknown): JsonObject {
    const jsonValue = toJsonValue(value);
    return isJsonObject(jsonValue) ? jsonValue : {};
}

export function toJsonValue(value: unknown): JsonValue {
    if (value === null) return null;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return Number.isFinite(value) || typeof value !== "number" ? value : String(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => toJsonValue(item));
    }

    if (typeof value === "object") {
        const entries = Object.entries(value).map(([key, entryValue]) => [key, toJsonValue(entryValue)]);
        return Object.fromEntries(entries) as JsonObject;
    }

    return String(value);
}

export function isJsonObject(value: JsonValue): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function errorToMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
