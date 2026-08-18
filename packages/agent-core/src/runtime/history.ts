import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { RawHistoryEvent, RawHistoryInput } from "./historyEvents";
import { restoreStoredMessages, serializeHistoryMessages } from "./historyMessages";

export type RawHistoryTurn = {
    turnId: string;
    inputIds: string[];
    messages: BaseMessage[];
};

export type RawHistoryCheckpoint = {
    compactionId: string;
    coveredSequence: number;
    summary: string;
    preservedTurns: RawHistoryTurn[];
    promptVersion: string;
    model: string;
    trigger: "manual" | "scheduled";
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
    contextCheckpoint?: RawHistoryCheckpoint;
    knownCompactionIds: Set<string>;
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
        knownCompactionIds: new Set(),
        lastSequence: 0,
    };
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
                event: event.event,
                requestId: event.requestId,
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
        case "context.compacted": {
            if (state.knownCompactionIds.has(event.compactionId)) {
                throw new Error(`duplicate compaction ${event.compactionId}`);
            }
            if (event.coveredSequence !== state.lastSequence) {
                throw new Error(
                    `compaction ${event.compactionId} must cover sequence ${state.lastSequence}, received ${event.coveredSequence}`,
                );
            }
            if (state.contextCheckpoint && event.coveredSequence <= state.contextCheckpoint.coveredSequence) {
                throw new Error(`compaction ${event.compactionId} does not advance the checkpoint`);
            }
            if (state.activeTurns.size || state.pendingInputs.size || state.activeToolCalls.size) {
                throw new Error(`compaction ${event.compactionId} was recorded while runtime was active`);
            }

            const preservedTurns: RawHistoryTurn[] = event.preservedTurns.map((turn) => ({
                turnId: turn.turnId,
                inputIds: [...turn.inputIds],
                messages: restoreStoredMessages(turn.messages),
            }));
            if (new Set(preservedTurns.map((turn) => turn.turnId)).size !== preservedTurns.length) {
                throw new Error(`compaction ${event.compactionId} contains duplicate preserved turns`);
            }
            if (preservedTurns.some((turn) => !state.knownTurnIds.has(turn.turnId))) {
                throw new Error(`compaction ${event.compactionId} references an unknown preserved turn`);
            }
            if (preservedTurns.some((turn) => turn.messages.length === 0)) {
                throw new Error(`compaction ${event.compactionId} contains an empty turn`);
            }
            assertPreservedTurnSuffix(state, event, preservedTurns);
            state.contextCheckpoint = {
                compactionId: event.compactionId,
                coveredSequence: event.coveredSequence,
                summary: event.summary,
                preservedTurns,
                promptVersion: event.promptVersion,
                model: event.model,
                trigger: event.trigger,
            };
            state.committedTurns = [];
            state.toolEvents = [];
            state.knownCompactionIds.add(event.compactionId);
            break;
        }
    }

    state.knownEventIds.add(event.eventId);
    state.lastSequence = event.sequence;
}

function assertPreservedTurnSuffix(
    state: RawHistoryState,
    event: Extract<RawHistoryEvent, { type: "context.compacted" }>,
    restoredTurns: RawHistoryTurn[],
): void {
    const candidates = [...(state.contextCheckpoint?.preservedTurns ?? []), ...state.committedTurns];
    if (event.preservedTurns.length > candidates.length) {
        throw new Error(`compaction ${event.compactionId} preserves more turns than the active context contains`);
    }

    const suffixStart = candidates.length - event.preservedTurns.length;
    for (let index = 0; index < event.preservedTurns.length; index += 1) {
        const actual = event.preservedTurns[index];
        const expected = candidates[suffixStart + index];
        if (!actual || !expected || actual.turnId !== expected.turnId) {
            throw new Error(`compaction ${event.compactionId} preserved turns are not an active-context suffix`);
        }
        if (actual.inputIds.join("\0") !== expected.inputIds.join("\0")) {
            throw new Error(`compaction ${event.compactionId} changed preserved turn inputs for ${actual.turnId}`);
        }
        const restored = restoredTurns[index];
        if (
            !restored ||
            JSON.stringify(toComparableStoredMessages(restored.messages)) !==
                JSON.stringify(toComparableStoredMessages(expected.messages))
        ) {
            throw new Error(`compaction ${event.compactionId} changed preserved turn messages for ${actual.turnId}`);
        }
    }
}

function toComparableStoredMessages(messages: BaseMessage[]) {
    return serializeHistoryMessages(messages).map((message) => {
        const data = { ...message.data };
        delete data.id;
        return { ...message, data };
    });
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

function assertActiveTurn(state: RawHistoryState, turnId: string): void {
    if (!state.activeTurns.has(turnId)) {
        throw new Error(`turn ${turnId} is not active`);
    }
}
