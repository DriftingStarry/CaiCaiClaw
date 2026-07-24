import {
    BaseMessage,
    HumanMessage,
} from "@langchain/core/messages";
import { CompiledStateGraph } from "@langchain/langgraph";
import { appendFile } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { AgentConfig, getAgent, ToolResultEvent, ToolStartEvent } from "../agent.js";
import { runAgentStream } from "./agentStream.js";
import { buildContext } from "./context.js";
import {
    applyRawHistoryEvent,
    createEmptyRawHistoryState,
    HISTORY_VERSION,
    markInterruptedHistory,
    rawHistoryEventSchema,
    RawHistoryEvent,
    RawHistoryEventDraft,
    RawHistoryState,
    serializeHistoryMessages,
} from "./history.js";
import { EventQueue } from "./eventQueue.js";
import {
    AgentRuntimeOptions,
    InboundEvent,
    RuntimeOutputEmitter,
    RuntimeOutputEvent,
    RuntimeState,
} from "./types.js";

export class AgentRuntime {
    private readonly queue = new EventQueue();
    private rawHistoryState: RawHistoryState;
    private executionState: RuntimeState = { messages: [], llmCalls: 0 };
    private readonly agent: CompiledStateGraph<any, any, any, any, any>;
    private running = false;
    private readonly heartbeatMs: number;
    private readonly onOutput?: RuntimeOutputEmitter;
    private activeTurnId?: string;
    private readonly rawHistoryPath: string;
    private readonly systemPromptPath: string;
    private systemPrompt = "";
    private historyWriteTail: Promise<void> = Promise.resolve();
    private fatalError?: Error;

    constructor(config: AgentConfig, options: AgentRuntimeOptions) {
        this.rawHistoryPath = options.rawHistoryPath;
        this.heartbeatMs = options.heartbeatMs ?? 30_000;
        this.onOutput = options.onOutput;
        this.rawHistoryState = createEmptyRawHistoryState();

        this.loadRawHistory();

        this.systemPromptPath = config.systemPromptPath;
        this.loadSystemPrompt();

        this.agent = getAgent({
            ...config,
            onToolStart: async (event) => {
                await this.emitToolStart(event);
                await config.onToolStart?.(event);
            },
            onToolResult: async (event) => {
                await this.emitToolResult(event);
                await config.onToolResult?.(event);
            },
        });
    }

    public async enqueue(event: InboundEvent): Promise<void> {
        this.assertAvailable();

        const inputId = event.inputId ?? this.createId("input");
        const createdAt = event.createdAt ?? Date.now();
        const normalizedEvent: InboundEvent = { ...event, inputId, createdAt };
        const message = this.createHumanMessage(normalizedEvent);

        await this.appendRawHistoryEvent({
            type: "input.accepted",
            createdAt,
            inputId,
            text: normalizedEvent.text,
            source: normalizedEvent.source,
            message: message.toDict(),
        });

        this.queue.enqueue(normalizedEvent);
    }

    public async run() {
        if (this.running) return;
        this.running = true;

        try {
            while (this.running) {
                const events = await this.queue.drainWithin(this.heartbeatMs);

                if (events.length === 0) {
                    await this.onHeartbeat();
                    continue;
                }

                await this.handleEvents(events);
            }
        } catch (error) {
            this.fatalError = this.toError(error, "runtime stopped");
            throw error;
        } finally {
            this.running = false;
        }
    }

    public stop() {
        this.running = false;
        this.queue.wakeStopped();
    }

    public async step() {
        this.assertAvailable();
        const events = this.queue.drain();
        if (!events.length) throw new Error("no evt to do");

        try {
            await this.handleEvents(events);
        } catch (error) {
            this.fatalError = this.toError(error, "runtime step failed");
            throw error;
        }
    }

    public loadSystemPrompt() {
	if (this.systemPrompt === '') return // not set systemPrompt, do nothing
        try {
            this.systemPrompt = readFileSync(this.systemPromptPath, "utf-8");
        } catch (error) {
            throw Error(`${error}`);
        }
    }

    private loadRawHistory(): void {
        let content: string;

        try {
            content = readFileSync(this.rawHistoryPath, "utf-8");
        } catch (error) {
            if (!isFileMissingError(error)) throw this.toError(error, "raw history cannot be read");

            mkdirSync(dirname(this.rawHistoryPath), { recursive: true });
            writeFileSync(this.rawHistoryPath, "", { flag: "a" });
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
                this.applyRawHistoryEvent(parsed.data);
            } catch (error) {
                throw new Error(`raw history line ${index + 1} cannot be replayed: ${errorMessage(error)}`);
            }
        }

        this.markInterruptedHistory();
    }

    private async appendRawHistoryEvent(event: RawHistoryEventDraft): Promise<void> {
        this.assertAvailable();

        const operation = this.historyWriteTail.then(async () => {
            this.assertAvailable();
            const record = rawHistoryEventSchema.parse({
                version: HISTORY_VERSION,
                sequence: this.rawHistoryState.lastSequence + 1,
                eventId: this.createId("event"),
                ...event,
            });

            try {
                await appendFile(this.rawHistoryPath, `${JSON.stringify(record)}\n`, "utf-8");
            } catch (error) {
                throw this.toError(error, "raw history append failed");
            }

            this.applyRawHistoryEvent(record);
        });

        this.historyWriteTail = operation.catch((error) => {
            this.fatalError = this.toError(error, "runtime persistence failed");
        });

        await operation;
    }

    private applyRawHistoryEvent(event: RawHistoryEvent): void {
        applyRawHistoryEvent(this.rawHistoryState, event);
    }

    private markInterruptedHistory(): void {
        markInterruptedHistory(this.rawHistoryState);
    }

    private buildContext(inputMessages: BaseMessage[]): BaseMessage[] {
        return buildContext(this.systemPrompt, this.rawHistoryState, inputMessages);
    }

    private async handleEvents(events: InboundEvent[]) {
        const inputIds = events.map((event) => {
            if (!event.inputId) throw new Error("queued input is missing inputId");
            return event.inputId;
        });
        const turnId = this.createId("turn");
        const turnCreatedAt = Date.now();

        await this.appendRawHistoryEvent({
            type: "turn.started",
            createdAt: turnCreatedAt,
            turnId,
            inputIds,
        });
        this.activeTurnId = turnId;

        let outputCommitted = false;

        try {
            for (const event of events) {
                await this.emitOutput({
                    type: "input_accepted",
                    turnId,
                    text: event.text,
                    source: event.source,
                    createdAt: event.createdAt ?? turnCreatedAt,
                });
            }

            await this.emitOutput({ type: "turn_start", turnId, createdAt: turnCreatedAt });

            const inputMessages = events.map((event) => this.createHumanMessage(event));
            const executionInput: RuntimeState = {
                messages: this.buildContext(inputMessages),
                llmCalls: 0,
            };
            this.executionState = executionInput;

            const finalState = await runAgentStream(
                this.agent,
                turnId,
                executionInput,
                this.emitOutput.bind(this),
            );
            const completedState = finalState ?? executionInput;
            this.executionState = { messages: completedState.messages, llmCalls: completedState.llmCalls };

            await this.appendRawHistoryEvent({
                type: "turn.output_committed",
                createdAt: Date.now(),
                turnId,
                messages: serializeHistoryMessages(completedState.messages.slice(executionInput.messages.length)),
            });
            outputCommitted = true;

            await this.emitOutput({ type: "done", turnId });
        } catch (error) {
            if (outputCommitted) throw error;

            if (!this.fatalError) {
                try {
                    await this.appendRawHistoryEvent({
                        type: "turn.failed",
                        createdAt: Date.now(),
                        turnId,
                        message: normalizeFailureMessage(error),
                    });
                } catch (persistenceError) {
                    throw persistenceError;
                }
            }

            await this.emitOutput({ type: "error", turnId, error });
        } finally {
            this.activeTurnId = undefined;
        }
    }

    private async onHeartbeat() {
        // P0 keeps heartbeat as a scheduling extension point.
    }

    private async emitOutput(event: RuntimeOutputEvent): Promise<void> {
        await this.onOutput?.(event);
    }

    private async emitToolStart(event: ToolStartEvent): Promise<void> {
        const turnId = this.activeTurnId;
        if (!turnId) return;

        await this.appendRawHistoryEvent({
            type: "tool.started",
            turnId,
            toolCallId: event.toolCallId,
            name: event.name,
            args: event.args,
            createdAt: event.createdAt,
        });
        await this.emitOutput({
            type: "tool_call_start",
            turnId,
            toolCallId: event.toolCallId,
            name: event.name,
            args: event.args,
            createdAt: event.createdAt,
        });
    }

    private async emitToolResult(event: ToolResultEvent): Promise<void> {
        const turnId = this.activeTurnId;
        if (!turnId) return;

        await this.appendRawHistoryEvent({
            type: "tool.completed",
            turnId,
            toolCallId: event.toolCallId,
            name: event.name,
            status: event.status,
            result: event.result,
            createdAt: event.createdAt,
        });
        await this.emitOutput({
            type: "tool_call_result",
            turnId,
            toolCallId: event.toolCallId,
            name: event.name,
            status: event.status,
            result: event.result,
            createdAt: event.createdAt,
        });
    }

    private createHumanMessage(event: InboundEvent): HumanMessage {
        const prefix = event.source ? `[${event.source}] ` : "";
        return new HumanMessage(`${prefix}${event.text}`);
    }

    private assertAvailable(): void {
        if (this.fatalError) throw this.fatalError;
    }

    private createId(prefix: string): string {
        return `${prefix}-${randomUUID()}`;
    }

    private toError(error: unknown, fallback: string): Error {
        return new Error(`${fallback}: ${errorMessage(error)}`);
    }
}

function isFileMissingError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function normalizeFailureMessage(error: unknown): string {
    const message = errorMessage(error)
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .replace(/\s+/g, " ")
        .trim();

    if (!message) return "unknown runtime error";
    return message.length > 2_000 ? `${message.slice(0, 2_000)}...` : message;
}
