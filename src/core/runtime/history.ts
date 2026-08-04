import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    mapChatMessagesToStoredMessages,
    mapStoredMessagesToChatMessages,
    StoredMessage,
    ToolMessage,
} from "@langchain/core/messages";
import { errorMessage } from "@caicaiclaw/tool";
import { z } from "zod";

export const HISTORY_VERSION = 1;
export const HISTORY_WINDOW_MESSAGES = 30;

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
    createdAt: number;
    message: BaseMessage;
};

export type RawHistoryTurn = {
    turnId: string;
    inputIds: string[];
    messages: BaseMessage[];
};

export type RawHistoryToolEvent = {
    type: "started" | "completed";
    turnId: string;
    toolCallId: string;
    name: string;
    status?: "success" | "error";
    args?: Record<string, unknown>;
    result?: unknown;
    createdAt: number;
};

export type RawHistoryState = {
    committedTurns: RawHistoryTurn[];
    pendingInputs: Map<string, RawHistoryInput>;
    interruptedInputs: Map<string, RawHistoryInput>;
    activeTurns: Map<string, string[]>;
    activeToolCalls: Map<string, Set<string>>;
    knownInputIds: Set<string>;
    knownTurnIds: Set<string>;
    knownEventIds: Set<string>;
    failedTurns: Map<string, string>;
    interruptedInputIds: Set<string>;
    interruptedTurnIds: Set<string>;
    toolEvents: RawHistoryToolEvent[];
    lastSequence: number;
};

export function createEmptyRawHistoryState(): RawHistoryState {
    return {
        committedTurns: [],
        pendingInputs: new Map(),
        interruptedInputs: new Map(),
        activeTurns: new Map(),
        activeToolCalls: new Map(),
        knownInputIds: new Set(),
        knownTurnIds: new Set(),
        knownEventIds: new Set(),
        failedTurns: new Map(),
        interruptedInputIds: new Set(),
        interruptedTurnIds: new Set(),
        toolEvents: [],
        lastSequence: 0,
    };
}

export function serializeHistoryMessages(messages: BaseMessage[]): StoredMessagePayload[] {
    return mapChatMessagesToStoredMessages(messages).map(sanitizeStoredMessage);
}

/** Serializes one message for persistence, applying the same sanitizing as a batch. */
export function serializeHistoryMessage(message: BaseMessage): StoredMessagePayload {
    const [stored] = serializeHistoryMessages([message]);
    if (!stored) throw new Error("message could not be serialized");
    return stored;
}

export function applyRawHistoryEvent(state: RawHistoryState, event: RawHistoryEvent): void {
    const expectedSequence = state.lastSequence + 1;
    if (event.sequence !== expectedSequence) {
        throw new Error(`expected sequence ${expectedSequence}, received ${event.sequence}`);
    }
    if (state.knownEventIds.has(event.eventId)) {
        throw new Error(`duplicate event ${event.eventId}`);
    }

    switch (event.type) {
        case "input.accepted": {
            if (state.knownInputIds.has(event.inputId)) {
                throw new Error(`duplicate input ${event.inputId}`);
            }

            const message = restoreStoredMessages([event.message])[0];
            if (!message) throw new Error("input event has no message");
            if (!HumanMessage.isInstance(message)) {
                throw new Error("input event message must be human");
            }

            state.knownInputIds.add(event.inputId);
            state.pendingInputs.set(event.inputId, {
                inputId: event.inputId,
                text: event.text,
                source: event.source,
                createdAt: event.createdAt,
                message,
            });
            break;
        }
        case "turn.started": {
            if (state.knownTurnIds.has(event.turnId)) {
                throw new Error(`duplicate turn ${event.turnId}`);
            }
            if (new Set(event.inputIds).size !== event.inputIds.length) {
                throw new Error(`turn ${event.turnId} contains duplicate inputs`);
            }

            for (const inputId of event.inputIds) {
                if (!state.pendingInputs.has(inputId)) {
                    throw new Error(`turn ${event.turnId} references unknown input ${inputId}`);
                }
                if ([...state.activeTurns.values()].some((ids) => ids.includes(inputId))) {
                    throw new Error(`input ${inputId} is already assigned to an active turn`);
                }
            }

            state.knownTurnIds.add(event.turnId);
            state.activeTurns.set(event.turnId, [...event.inputIds]);
            break;
        }
        case "tool.started":
            assertActiveTurn(state, event.turnId);
            if (!state.activeToolCalls.has(event.turnId)) {
                state.activeToolCalls.set(event.turnId, new Set());
            }
            if (state.activeToolCalls.get(event.turnId)?.has(event.toolCallId)) {
                throw new Error(`duplicate tool start ${event.toolCallId}`);
            }
            state.activeToolCalls.get(event.turnId)?.add(event.toolCallId);
            state.toolEvents.push({
                type: "started",
                turnId: event.turnId,
                toolCallId: event.toolCallId,
                name: event.name,
                args: event.args,
                createdAt: event.createdAt,
            });
            break;
        case "tool.completed":
            assertActiveTurn(state, event.turnId);
            if (!state.activeToolCalls.get(event.turnId)?.has(event.toolCallId)) {
                throw new Error(`tool ${event.toolCallId} was not started`);
            }
            state.activeToolCalls.get(event.turnId)?.delete(event.toolCallId);
            state.toolEvents.push({
                type: "completed",
                turnId: event.turnId,
                toolCallId: event.toolCallId,
                name: event.name,
                status: event.status,
                result: event.result,
                createdAt: event.createdAt,
            });
            break;
        case "turn.output_committed": {
            const inputIds = state.activeTurns.get(event.turnId);
            if (!inputIds) throw new Error(`turn ${event.turnId} is not active`);
            if (state.activeToolCalls.get(event.turnId)?.size) {
                throw new Error(`turn ${event.turnId} has unfinished tools`);
            }

            const inputMessages = inputIds.map((inputId) => {
                const input = state.pendingInputs.get(inputId);
                if (!input) throw new Error(`turn ${event.turnId} is missing input ${inputId}`);
                return input.message;
            });

            const outputMessages = restoreStoredMessages(event.messages);
            if (outputMessages.some((message) => !AIMessage.isInstance(message) && !ToolMessage.isInstance(message))) {
                throw new Error(`turn ${event.turnId} output contains a non AI/tool message`);
            }
            state.committedTurns.push({
                turnId: event.turnId,
                inputIds: [...inputIds],
                messages: [...inputMessages, ...outputMessages],
            });

            for (const inputId of inputIds) {
                state.pendingInputs.delete(inputId);
            }
            state.activeTurns.delete(event.turnId);
            state.activeToolCalls.delete(event.turnId);
            break;
        }
        case "turn.failed": {
            const inputIds = state.activeTurns.get(event.turnId);
            if (!inputIds) throw new Error(`turn ${event.turnId} is not active`);

            state.failedTurns.set(event.turnId, event.message);
            for (const inputId of inputIds) {
                state.pendingInputs.delete(inputId);
            }
            state.activeTurns.delete(event.turnId);
            state.activeToolCalls.delete(event.turnId);
            break;
        }
    }

    state.knownEventIds.add(event.eventId);
    state.lastSequence = event.sequence;
}

export function markInterruptedHistory(state: RawHistoryState): void {
    for (const [turnId, inputIds] of state.activeTurns) {
        state.interruptedTurnIds.add(turnId);
        for (const inputId of inputIds) {
            state.interruptedInputIds.add(inputId);
            const input = state.pendingInputs.get(inputId);
            if (input) state.interruptedInputs.set(inputId, input);
        }
    }

    for (const [inputId, input] of state.pendingInputs) {
        state.interruptedInputIds.add(inputId);
        state.interruptedInputs.set(inputId, input);
    }

    state.activeTurns.clear();
    state.pendingInputs.clear();
    state.activeToolCalls.clear();
}

function restoreStoredMessages(messages: StoredMessagePayload[]): BaseMessage[] {
    try {
        return mapStoredMessagesToChatMessages(messages.map(sanitizeStoredMessage).map(toLangChainStoredMessage));
    } catch (error) {
        throw new Error(`invalid stored message: ${errorMessage(error)}`);
    }
}

/**
 * The single adapter between our validated payload and LangChain's `StoredMessage`.
 * `StoredMessageData` declares `content: string` and no index signature, but LangChain
 * itself writes array content and extra keys, so the declared type is narrower than the
 * real wire format. The cast is confined here; `sanitizeStoredMessage` has already
 * validated `type`/`data` before this point.
 */
function toLangChainStoredMessage(message: StoredMessagePayload): StoredMessage {
    return message as StoredMessage;
}

function sanitizeStoredMessage(message: StoredMessage | StoredMessagePayload): StoredMessagePayload {
    const data: Record<string, unknown> = { ...message.data };
    const additionalKwargs = data.additional_kwargs;

    if (isRecord(additionalKwargs)) {
        const sanitizedAdditionalKwargs = { ...additionalKwargs };
        delete sanitizedAdditionalKwargs.reasoning_content;
        delete sanitizedAdditionalKwargs.reasoning_details;
        data.additional_kwargs = sanitizedAdditionalKwargs;
    }

    if (Array.isArray(data.content)) {
        data.content = data.content.filter((block) => !isRecord(block) || block.type !== "reasoning");
    }

    return storedMessageSchema.parse({ type: message.type, data });
}

function assertActiveTurn(state: RawHistoryState, turnId: string): void {
    if (!state.activeTurns.has(turnId)) {
        throw new Error(`turn ${turnId} is not active`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
