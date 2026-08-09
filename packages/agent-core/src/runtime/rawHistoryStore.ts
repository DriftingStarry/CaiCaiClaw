import { appendFile } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorMessage } from "@caicaiclaw/utils";
import {
    applyRawHistoryEvent,
    createEmptyRawHistoryState,
    markInterruptedHistory,
    RawHistoryState,
} from "./history.js";
import {
    HISTORY_VERSION,
    rawHistoryEventSchema,
    RawHistoryEvent,
    RawHistoryEventDraft,
} from "./historyEvents.js";

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

    constructor(options: RawHistoryStoreOptions) {
        this.path = options.path;
        this.createIdFn = options.createId;
        this.onFatalErrorFn = options.onFatalError;
        this.assertAvailableFn = options.assertAvailable;
    }

    public get projection(): RawHistoryState {
        return this.state;
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

            let value: unknown;
            try {
                value = JSON.parse(line);
            } catch {
                throw new Error(`raw history line ${index + 1} is not valid JSON`);
            }

            const parsed = rawHistoryEventSchema.safeParse(value);
            if (!parsed.success) {
                throw new Error(`raw history line ${index + 1} has an invalid event schema`);
            }

            try {
                this.apply(parsed.data);
            } catch (error) {
                throw new Error(`raw history line ${index + 1} cannot be replayed: ${errorMessage(error)}`);
            }
        }

        this.markInterrupted();
    }

    public async append(event: RawHistoryEventDraft): Promise<void> {
        this.assertAvailableFn();

        const operation = this.writeTail.then(async () => {
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
        });

        this.writeTail = operation.catch((error) => {
            this.onFatalErrorFn(toError(error, "runtime persistence failed"));
        });

        await operation;
    }

    private apply(event: RawHistoryEvent): void {
        applyRawHistoryEvent(this.state, event);
    }

    private markInterrupted(): void {
        markInterruptedHistory(this.state);
    }
}

function isFileMissingError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function toError(error: unknown, fallback: string): Error {
    return new Error(`${fallback}: ${errorMessage(error)}`);
}
