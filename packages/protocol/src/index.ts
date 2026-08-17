import { z } from "zod";

export const WS_PROTOCOL_VERSION = 3;
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

export const clientCompactMessageSchema = z
    .object({
        type: z.literal("compact"),
        requestId: requestIdSchema,
    })
    .strict();

export const clientDaydreamingMessageSchema = z
    .object({
        type: z.literal("daydreaming"),
        requestId: requestIdSchema,
    })
    .strict();

export const clientMessageSchema = z.discriminatedUnion("type", [
    clientInputMessageSchema,
    clientPingMessageSchema,
    clientCompactMessageSchema,
    clientDaydreamingMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

const jsonObjectSchema = z.record(z.string(), z.json());

export const serverHelloMessageSchema = z.object({
    type: z.literal("hello"),
    protocolVersion: z.number(),
    clientId: z.string(),
});

export const serverAckMessageSchema = z.object({
    type: z.literal("ack"),
    requestId: requestIdSchema,
});

export const serverInputAcceptedMessageSchema = z.object({
    type: z.literal("input_accepted"),
    turnId: z.string(),
    text: z.string(),
    source: z.string().optional(),
    requestId: requestIdSchema,
    createdAt: z.number(),
});

export const serverAgentTurnStartMessageSchema = z.object({
    type: z.literal("agent_turn_start"),
    turnId: z.string(),
    createdAt: z.number(),
});

export const serverAssistantMessageDeltaSchema = z.object({
    type: z.literal("assistant_message_delta"),
    turnId: z.string(),
    text: z.string(),
    metadata: jsonObjectSchema,
});

export const serverReasoningDeltaSchema = z.object({
    type: z.literal("reasoning_delta"),
    turnId: z.string(),
    text: z.string(),
    metadata: jsonObjectSchema,
});

export const serverToolCallStartMessageSchema = z.object({
    type: z.literal("tool_call_start"),
    turnId: z.string(),
    toolCallId: z.string(),
    name: z.string(),
    args: jsonObjectSchema,
    createdAt: z.number(),
});

export const serverToolCallResultMessageSchema = z.object({
    type: z.literal("tool_call_result"),
    turnId: z.string(),
    toolCallId: z.string(),
    name: z.string(),
    status: z.enum(["success", "error"]),
    result: z.json(),
    createdAt: z.number(),
});

export const serverAgentTurnDoneMessageSchema = z.object({
    type: z.literal("agent_turn_done"),
    turnId: z.string(),
    createdAt: z.number(),
});

export const serverErrorMessageSchema = z.object({
    type: z.literal("error"),
    message: z.string(),
    requestId: requestIdSchema,
    turnId: z.string().optional(),
});

export const serverPongMessageSchema = z.object({
    type: z.literal("pong"),
    requestId: requestIdSchema,
});

export const serverCompactResultMessageSchema = z
    .object({
        type: z.literal("compact_result"),
        summary: z.string().min(1),
        trigger: z.enum(["manual", "scheduled"]),
        requestId: requestIdSchema,
    })
    .strict();

export const serverDaydreamingResultMessageSchema = z
    .object({
        type: z.literal("daydreaming_result"),
        summary: z.string().min(1),
        requestId: requestIdSchema,
    })
    .strict();

export const serverMessageSchema = z.discriminatedUnion("type", [
    serverHelloMessageSchema,
    serverAckMessageSchema,
    serverInputAcceptedMessageSchema,
    serverAgentTurnStartMessageSchema,
    serverAssistantMessageDeltaSchema,
    serverReasoningDeltaSchema,
    serverToolCallStartMessageSchema,
    serverToolCallResultMessageSchema,
    serverAgentTurnDoneMessageSchema,
    serverErrorMessageSchema,
    serverPongMessageSchema,
    serverCompactResultMessageSchema,
    serverDaydreamingResultMessageSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

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

export function parseServerMessage(raw: string): ServerMessage | undefined {
    let data: unknown;

    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error("message must be valid JSON");
    }

    const messageType = typeof data === "object" && data !== null && "type" in data ? data.type : undefined;
    const isKnownType = serverMessageSchema.options.some((option) => option.shape.type.value === messageType);
    if (!isKnownType) {
        // Unknown types return undefined for forward compatibility and are discarded by callers.
        return undefined;
    }

    const parsed = serverMessageSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(z.prettifyError(parsed.error));
    }

    return parsed.data;
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
