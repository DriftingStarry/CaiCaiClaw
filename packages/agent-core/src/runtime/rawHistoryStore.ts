import { appendFile } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorMessage } from "@caicaiclaw/utils";
import {
    HISTORY_VERSION,
    parseHistoryLine,
    rawHistoryEventSchema,
    type RawHistoryEvent,
    type RawHistoryEventDraft,
} from "@caicaiclaw/utils/history";
import { applyRawHistoryEvent, createEmptyRawHistoryState, markInterruptedHistory, RawHistoryState } from "./history";
import { HistoryQueryInput, HistoryQueryRecord, ToolResultPage } from "./types";

export type RawHistoryStoreOptions = {
    path: string;
    /** 生成 eventId，由 AgentRuntime 注入以复用同一套 id 规则。 */
    createId: (prefix: string) => string;
    /** fatalError 是运行时级状态，store 只负责上报。 */
    onFatalError: (error: Error) => void;
    /** 运行时已进入不可用状态时抛出，阻止继续写入。 */
    assertAvailable: () => void;
};

export class RawHistoryStore {
    private state: RawHistoryState = createEmptyRawHistoryState();
    private writeTail: Promise<void> = Promise.resolve();
    private readonly path: string;
    private readonly createIdFn: (prefix: string) => string;
    private readonly onFatalErrorFn: (error: Error) => void;
    private readonly assertAvailableFn: () => void;
    private exclusiveBarrier: Promise<void> | undefined;

    constructor(options: RawHistoryStoreOptions) {
        this.path = options.path;
        this.createIdFn = options.createId;
        this.onFatalErrorFn = options.onFatalError;
        this.assertAvailableFn = options.assertAvailable;
    }

    public get projection(): RawHistoryState {
        return this.state;
    }

    public async withExclusive<T>(
        operation: (append: (event: RawHistoryEventDraft) => Promise<void>) => Promise<T>,
    ): Promise<T> {
        const pendingWrites = this.writeTail;
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.exclusiveBarrier = barrier;
        try {
            await pendingWrites;
            return await operation((event) => this.appendRecord(event));
        } finally {
            this.exclusiveBarrier = undefined;
            release();
        }
    }

    public readToolResult(turnId: string, toolCallId: string, offset = 0, limit = 4_000): ToolResultPage {
        if (!Number.isInteger(offset) || offset < 0)
            throw new Error("tool result offset must be a non-negative integer");
        if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) {
            throw new Error("tool result limit must be an integer between 1 and 100000");
        }

        let content: string;
        try {
            content = readFileSync(this.path, "utf-8");
        } catch (error) {
            throw toError(error, "tool result history cannot be read");
        }

        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (!line.trim()) continue;
            const parsed = parseHistoryLine(line);
            if (!parsed.success) {
                throw new Error(`raw history line ${index + 1} ${parsed.error.replace(/^history line /, "")}`);
            }
            if (parsed.event.type !== "tool.completed") continue;
            if (parsed.event.turnId !== turnId || parsed.event.toolCallId !== toolCallId) continue;

            const result = stringifyToolResult(parsed.event.result);
            if (offset > result.length) {
                throw new Error(
                    `tool result offset ${offset} is out of bounds for ${turnId}/${toolCallId} with length ${result.length}`,
                );
            }
            const page = result.slice(offset, offset + limit);
            return {
                turnId,
                toolCallId,
                status: parsed.event.status,
                totalLength: result.length,
                offset,
                limit,
                content: page,
                hasMore: offset + page.length < result.length,
            };
        }
        throw new Error(`tool result ${turnId}/${toolCallId} was not found`);
    }

    public queryHistory(input: HistoryQueryInput): HistoryQueryRecord[] {
        if (!Number.isInteger(input.offset) || input.offset < 0)
            throw new Error("history query offset must be non-negative");
        if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
            throw new Error("history query limit must be between 1 and 100");
        if (input.from !== undefined && input.to !== undefined && input.from > input.to)
            throw new Error("history query from must not exceed to");
        let content: string;
        try {
            content = readFileSync(this.path, "utf-8");
        } catch (error) {
            throw toError(error, "history query cannot read history");
        }
        const matches: HistoryQueryRecord[] = [];
        for (const [index, line] of content.split(/\r?\n/).entries()) {
            if (!line.trim()) continue;
            const parsed = parseHistoryLine(line);
            if (!parsed.success)
                throw new Error(`raw history line ${index + 1} ${parsed.error.replace(/^history line /, "")}`);
            if (parsed.event.type !== "input.accepted") continue;
            const event = parsed.event.event;
            if (input.conversationId && event.conversationId !== input.conversationId) continue;
            if (input.channel && event.channel !== input.channel) continue;
            if (input.kind && event.kind !== input.kind) continue;
            if (input.authorId && event.author.id !== input.authorId) continue;
            if (input.from !== undefined && event.occurredAt < input.from) continue;
            if (input.to !== undefined && event.occurredAt > input.to) continue;
            matches.push({
                inputId: parsed.event.inputId,
                sequence: parsed.event.sequence,
                createdAt: parsed.event.createdAt,
                event,
            });
        }
        if (input.offset > matches.length)
            throw new Error(`history query offset ${input.offset} is out of bounds for ${matches.length} matches`);
        return matches.slice(input.offset, input.offset + input.limit);
    }

    public load(): void {
        let content: string;

        try {
            content = readFileSync(this.path, "utf-8");
        } catch (error) {
            if (!isFileMissingError(error)) throw toError(error, "raw history cannot be read");

            mkdirSync(dirname(this.path), { recursive: true });
            writeFileSync(this.path, "", { flag: "a" });
            return;
        }

        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (!line.trim()) continue;

            const parsed = parseHistoryLine(line);
            if (!parsed.success) {
                throw new Error(`raw history line ${index + 1} ${parsed.error.replace(/^history line /, "")}`);
            }

            try {
                this.apply(parsed.event);
            } catch (error) {
                throw new Error(`raw history line ${index + 1} cannot be replayed: ${errorMessage(error)}`, {
                    cause: error,
                });
            }
        }

        this.markInterrupted();
    }

    public async append(event: RawHistoryEventDraft): Promise<void> {
        this.assertAvailableFn();

        const barrier = this.exclusiveBarrier;
        const operation = this.writeTail.then(() => barrier).then(() => this.appendRecord(event));

        this.writeTail = operation.catch((error) => {
            this.onFatalErrorFn(toError(error, "runtime persistence failed"));
        });

        await operation;
    }

    private async appendRecord(event: RawHistoryEventDraft): Promise<void> {
        this.assertAvailableFn();
        const record = rawHistoryEventSchema.parse({
            version: HISTORY_VERSION,
            sequence: this.state.lastSequence + 1,
            eventId: this.createIdFn("event"),
            ...event,
        });
        try {
            await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf-8");
        } catch (error) {
            throw toError(error, "raw history append failed");
        }
        this.apply(record);
    }

    private apply(event: RawHistoryEvent): void {
        applyRawHistoryEvent(this.state, event);
    }

    private markInterrupted(): void {
        markInterruptedHistory(this.state);
    }
}

export function stringifyToolResult(result: unknown): string {
    if (typeof result === "string") return result;
    try {
        const serialized = JSON.stringify(result);
        if (serialized !== undefined) return serialized;
    } catch {
        // The event schema normally prevents this; return a safe explicit marker if a caller bypasses it.
    }
    return String(result);
}

function isFileMissingError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function toError(error: unknown, fallback: string): Error {
    return new Error(`${fallback}: ${errorMessage(error)}`, { cause: error });
}
