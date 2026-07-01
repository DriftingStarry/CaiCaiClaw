import { BaseMessage, StoredMessage } from "@langchain/core/messages";
import { z } from "zod/v4";
import { RuntimeOutputEvent } from "../runtime.js";

export const WS_PROTOCOL_VERSION = 1;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

const requestIdSchema = z.string().min(1).optional();

const clientInputMessageSchema = z.object({
    type: z.literal("input"),
    text: z.string().trim().min(1),
    source: z.string().trim().min(1).optional(),
    requestId: requestIdSchema,
});

const clientPingMessageSchema = z.object({
    type: z.literal("ping"),
    requestId: requestIdSchema,
});

export const clientMessageSchema = z.discriminatedUnion("type", [
    clientInputMessageSchema,
    clientPingMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

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
          type: "message";
          message: StoredMessage;
          metadata: JsonObject;
      }
    | {
          type: "done";
      }
    | {
          type: "error";
          message: string;
          requestId?: string;
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

export function serializeServerMessage(message: ServerMessage): string {
    return JSON.stringify(message);
}

export function runtimeOutputToServerMessage(event: RuntimeOutputEvent): ServerMessage {
    if (event.type === "message") {
        const [message, metadata] = event.chunk;
        return {
            type: "message",
            message: serializeBaseMessage(message),
            metadata: toJsonObject(metadata),
        };
    }

    if (event.type === "error") {
        return {
            type: "error",
            message: errorToMessage(event.error),
        };
    }

    return { type: "done" };
}

function serializeBaseMessage(message: BaseMessage): StoredMessage {
    return message.toDict();
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
    const jsonValue = toJsonValue(value);
    return isJsonObject(jsonValue) ? jsonValue : {};
}

function toJsonValue(value: unknown): JsonValue {
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

function isJsonObject(value: JsonValue): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function errorToMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
