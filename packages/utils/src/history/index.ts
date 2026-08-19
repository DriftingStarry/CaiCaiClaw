import { z } from "zod";

export const HISTORY_VERSION = 2;

const jsonObjectSchema = z.record(z.string(), z.json());

export const channelEventSchema = z
    .object({
        channel: z.string().min(1),
        conversationId: z.string().min(1),
        platformMessageId: z.string().min(1).optional(),
        kind: z.string().min(1),
        text: z.string(),
        author: z
            .object({
                id: z.string().min(1),
                displayName: z.string().optional(),
                isSelf: z.boolean(),
                role: z.string().optional(),
            })
            .strict(),
        payload: jsonObjectSchema.optional(),
        occurredAt: z.number().int().nonnegative(),
        receivedAt: z.number().int().nonnegative(),
        laneHint: z.enum(["fast", "deep"]).optional(),
        replyTo: z.string().min(1).optional(),
        debugOrigin: z.literal("admin").optional(),
    })
    .strict();

export type ChannelEvent = z.infer<typeof channelEventSchema>;

/**
 * Mirrors LangChain's `StoredMessage`, which is the JSONL wire format for persisted
 * messages. `looseObject` is required: LangChain writes provider-specific keys
 * (`tool_calls`, `invalid_tool_calls`, ...) that a strict object would silently drop,
 * corrupting replayed history.
 */
export const storedMessageSchema = z.object({
    type: z.string().min(1),
    data: z.looseObject({
        content: z.unknown(),
        role: z.string().optional(),
        name: z.string().optional(),
        tool_call_id: z.string().optional(),
    }),
});

export type StoredMessagePayload = z.infer<typeof storedMessageSchema>;

const compactedTurnSchema = z.object({
    turnId: z.string().min(1),
    inputIds: z.array(z.string().min(1)).min(1),
    messages: z.array(storedMessageSchema),
});

export const HISTORY_EVENT_TYPES = [
    "input.accepted",
    "input.dropped",
    "conversation.digested",
    "approval.requested",
    "approval.decided",
    "approval.expired",
    "turn.started",
    "tool.started",
    "tool.completed",
    "turn.output_committed",
    "turn.failed",
    "context.compacted",
] as const;

export type HistoryEventType = (typeof HISTORY_EVENT_TYPES)[number];

export const rawHistoryEventSchema = z.discriminatedUnion("type", [
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("approval.requested"),
        createdAt: z.number().int().nonnegative(),
        approvalId: z.string().min(1),
        turnId: z.string().min(1),
        toolName: z.string().min(1),
        args: jsonObjectSchema,
        expiresAt: z.number().int().positive(),
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("approval.decided"),
        createdAt: z.number().int().nonnegative(),
        approvalId: z.string().min(1),
        decision: z.enum(["approve", "deny"]),
        decidedBy: z.string().min(1),
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("approval.expired"),
        createdAt: z.number().int().nonnegative(),
        approvalId: z.string().min(1),
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("conversation.digested"),
        createdAt: z.number().int().nonnegative(),
        digestId: z.string().min(1),
        conversationId: z.string().min(1),
        coveredSequence: z.number().int().nonnegative(),
        digest: z.string().min(1),
        model: z.string().min(1),
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("input.accepted"),
        createdAt: z.number().int().nonnegative(),
        inputId: z.string().min(1),
        event: channelEventSchema,
        requestId: z.string().min(1).optional(),
        message: storedMessageSchema,
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("input.dropped"),
        createdAt: z.number().int().nonnegative(),
        inputId: z.string().min(1),
        event: channelEventSchema,
        reason: z.enum(["buffer_full", "priority_buffer_full", "lane_drop", "self_echo", "duplicate"]),
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("turn.started"),
        createdAt: z.number().int().nonnegative(),
        turnId: z.string().min(1),
        inputIds: z.array(z.string().min(1)).min(1),
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("tool.started"),
        createdAt: z.number().int().nonnegative(),
        turnId: z.string().min(1),
        toolCallId: z.string().min(1),
        name: z.string().min(1),
        args: jsonObjectSchema,
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("tool.completed"),
        createdAt: z.number().int().nonnegative(),
        turnId: z.string().min(1),
        toolCallId: z.string().min(1),
        name: z.string().min(1),
        status: z.enum(["success", "error"]),
        result: z.unknown(),
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("turn.output_committed"),
        createdAt: z.number().int().nonnegative(),
        turnId: z.string().min(1),
        messages: z.array(storedMessageSchema),
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("turn.failed"),
        createdAt: z.number().int().nonnegative(),
        turnId: z.string().min(1),
        message: z.string().min(1),
    }),
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("context.compacted"),
        createdAt: z.number().int().nonnegative(),
        compactionId: z.string().min(1),
        coveredSequence: z.number().int().nonnegative(),
        summary: z.string().min(1),
        preservedTurns: z.array(compactedTurnSchema),
        promptVersion: z.string().min(1),
        model: z.string().min(1),
        trigger: z.enum(["manual", "scheduled"]),
    }),
]);

export type RawHistoryEvent = z.infer<typeof rawHistoryEventSchema>;
export type RawHistoryEventDraft = {
    [Type in RawHistoryEvent["type"]]: Omit<
        Extract<RawHistoryEvent, { type: Type }>,
        "version" | "sequence" | "eventId"
    >;
}[RawHistoryEvent["type"]];

export type HistoryLineParseResult = { success: true; event: RawHistoryEvent } | { success: false; error: string };

export function parseHistoryLine(text: string): HistoryLineParseResult {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        return { success: false, error: `history line is not valid JSON: ${errorMessage(error)}` };
    }

    const parsed = rawHistoryEventSchema.safeParse(value);
    if (!parsed.success) {
        return { success: false, error: `history line has an invalid event schema: ${z.prettifyError(parsed.error)}` };
    }

    return { success: true, event: parsed.data };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
