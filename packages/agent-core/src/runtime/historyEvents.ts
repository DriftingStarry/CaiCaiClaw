import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

export const HISTORY_VERSION = 1;

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

const jsonObjectSchema = z.record(z.string(), z.unknown());
const compactedTurnSchema = z.object({
    turnId: z.string().min(1),
    inputIds: z.array(z.string().min(1)).min(1),
    messages: z.array(storedMessageSchema),
});

export const rawHistoryEventSchema = z.discriminatedUnion("type", [
    z.object({
        version: z.literal(HISTORY_VERSION),
        sequence: z.number().int().positive(),
        eventId: z.string().min(1),
        type: z.literal("input.accepted"),
        createdAt: z.number().int().nonnegative(),
        inputId: z.string().min(1),
        text: z.string(),
        source: z.string().optional(),
        requestId: z.string().min(1).optional(),
        message: storedMessageSchema,
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

export type RawHistoryInput = {
    inputId: string;
    text: string;
    source?: string;
    requestId?: string;
    createdAt: number;
    message: BaseMessage;
};
