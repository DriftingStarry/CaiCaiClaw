import { z } from "zod";
import { channelEventSchema } from "@caicaiclaw/utils/history";
import type { ChannelEvent } from "@caicaiclaw/utils/history";

export const WS_PROTOCOL_VERSION = 6;
export const MAX_CLIENT_ID_LENGTH = 64;
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const requestIdSchema = z.string().min(1).optional();
export const clientIdSchema = z.string().min(1).max(MAX_CLIENT_ID_LENGTH).regex(CLIENT_ID_PATTERN);

export const clientInputMessageSchema = z.object({
    type: z.literal("input"),
    event: channelEventSchema,
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

export const clientApprovalDecisionMessageSchema = z
    .object({
        type: z.literal("approval_decision"),
        approvalId: z.string().min(1),
        decision: z.enum(["approve", "deny"]),
        requestId: requestIdSchema,
    })
    .strict();

export const observerRoleMessageSchema = z
    .object({
        type: z.literal("role"),
        role: z.literal("observer"),
    })
    .strict();

export const adapterRoleMessageSchema = z
    .object({
        type: z.literal("role"),
        role: z.literal("adapter"),
        channel: z.string().min(1),
    })
    .strict();

export const adminRoleMessageSchema = z
    .object({
        type: z.literal("role"),
        role: z.literal("admin"),
    })
    .strict();

export const clientRoleMessageSchema = z.union([
    observerRoleMessageSchema,
    adapterRoleMessageSchema,
    adminRoleMessageSchema,
]);
export const connectionRoleSchema = z.discriminatedUnion("role", [
    z.object({ role: z.literal("observer") }).strict(),
    z.object({ role: z.literal("adapter"), channel: z.string().min(1) }).strict(),
    z.object({ role: z.literal("admin") }).strict(),
]);

export type ConnectionRole = z.infer<typeof connectionRoleSchema>;
export type ClientRoleMessage = z.infer<typeof clientRoleMessageSchema>;

export const clientMessageSchema = z.union([
    clientInputMessageSchema,
    clientPingMessageSchema,
    clientCompactMessageSchema,
    clientDaydreamingMessageSchema,
    clientApprovalDecisionMessageSchema,
    clientRoleMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

const jsonObjectSchema = z.record(z.string(), z.json());
const laneSchema = z.enum(["fast", "deep"]);
const outputTargetSchema = z
    .object({
        channel: z.string().min(1),
        conversationId: z.string().min(1),
        replyTo: z.string().min(1).optional(),
    })
    .strict();

export const serverHelloMessageSchema = z.object({
    type: z.literal("hello"),
    protocolVersion: z.number(),
    clientId: z.string(),
});

export const serverAckMessageSchema = z.object({
    type: z.literal("ack"),
    requestId: requestIdSchema,
    disposition: z.enum(["accepted", "merged", "dropped"]).optional(),
    reason: z.string().min(1).optional(),
    batchId: z.string().min(1).optional(),
});

export const serverInputDroppedMessageSchema = z.object({
    type: z.literal("input_dropped"),
    inputId: z.string().min(1),
    event: channelEventSchema,
    reason: z.enum(["buffer_full", "priority_buffer_full", "lane_drop", "self_echo", "duplicate"]),
    requestId: requestIdSchema,
    createdAt: z.number(),
});

export const serverInputAcceptedMessageSchema = z.object({
    type: z.literal("input_accepted"),
    turnId: z.string(),
    lane: laneSchema,
    event: channelEventSchema,
    requestId: requestIdSchema,
    createdAt: z.number(),
});

export const serverAgentTurnStartMessageSchema = z.object({
    type: z.literal("agent_turn_start"),
    turnId: z.string(),
    lane: laneSchema,
    createdAt: z.number(),
});

export const serverAssistantMessageDeltaSchema = z.object({
    type: z.literal("assistant_message_delta"),
    turnId: z.string(),
    lane: laneSchema,
    text: z.string(),
    metadata: jsonObjectSchema,
    target: outputTargetSchema.optional(),
});

export const serverOutboundReplyMessageSchema = z
    .object({
        type: z.literal("outbound_reply"),
        turnId: z.string().min(1),
        lane: laneSchema,
        target: outputTargetSchema,
        text: z.string().min(1),
        truncatedFrom: z.number().int().positive().optional(),
        createdAt: z.number(),
    })
    .strict();

export const serverReasoningDeltaSchema = z.object({
    type: z.literal("reasoning_delta"),
    turnId: z.string(),
    lane: laneSchema,
    text: z.string(),
    metadata: jsonObjectSchema,
});

export const serverToolCallStartMessageSchema = z.object({
    type: z.literal("tool_call_start"),
    turnId: z.string(),
    lane: laneSchema,
    toolCallId: z.string(),
    name: z.string(),
    args: jsonObjectSchema,
    createdAt: z.number(),
});

export const serverToolCallResultMessageSchema = z.object({
    type: z.literal("tool_call_result"),
    turnId: z.string(),
    lane: laneSchema,
    toolCallId: z.string(),
    name: z.string(),
    status: z.enum(["success", "error"]),
    result: z.json(),
    createdAt: z.number(),
});

export const serverAgentTurnDoneMessageSchema = z.object({
    type: z.literal("agent_turn_done"),
    turnId: z.string(),
    lane: laneSchema,
    createdAt: z.number(),
});

export const serverErrorMessageSchema = z.object({
    type: z.literal("error"),
    message: z.string(),
    requestId: requestIdSchema,
    turnId: z.string().optional(),
    lane: laneSchema.optional(),
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
    serverInputDroppedMessageSchema,
    serverInputAcceptedMessageSchema,
    serverAgentTurnStartMessageSchema,
    serverAssistantMessageDeltaSchema,
    serverOutboundReplyMessageSchema,
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
export type { ChannelEvent };

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
