import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { errorMessage } from "@caicaiclaw/utils";
import { AgentConfig, getAgent, ToolResultEvent, ToolStartEvent } from "../agent";
import { runAgentStream } from "./agentStream";
import { buildContext } from "./context";
import { serializeHistoryMessage, serializeHistoryMessages } from "./historyMessages";
import { EventQueue } from "./eventQueue";
import { RawHistoryStore } from "./rawHistoryStore";
import { AgentRuntimeOptions, ExecutionState, InboundEvent, RuntimeOutputEmitter, RuntimeOutputEvent } from "./types";

export class AgentRuntime {
    private readonly queue = new EventQueue();
    private executionState: ExecutionState = { messages: [], llmCalls: 0 };
    private readonly agent: ReturnType<typeof getAgent>;
    private running = false;
    private readonly heartbeatMs: number;
    private readonly onOutput?: RuntimeOutputEmitter;
    private readonly history: RawHistoryStore;
    private activeTurnId?: string;
    private readonly systemPromptPath: string;
    private systemPrompt = "";
    private fatalError?: Error;

    constructor(config: AgentConfig, options: AgentRuntimeOptions) {
        this.systemPromptPath = options.systemPromptPath;
        this.heartbeatMs = options.heartbeatMs ?? 30_000;
        this.onOutput = options.onOutput;
        this.history = new RawHistoryStore({
            path: options.rawHistoryPath,
            createId: (prefix) => this.createId(prefix),
            onFatalError: (error) => {
                this.fatalError = error;
            },
            assertAvailable: () => {
                this.assertAvailable();
            },
        });

        this.history.load();

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

        await this.history.append({
            type: "input.accepted",
            createdAt,
            inputId,
            text: normalizedEvent.text,
            source: normalizedEvent.source,
            requestId: normalizedEvent.requestId,
            message: serializeHistoryMessage(message),
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
        // prettier-ignore
        if (this.systemPromptPath === '') return // not set systemPrompt, do nothing
        try {
            this.systemPrompt = readFileSync(this.systemPromptPath, "utf-8");
        } catch (error) {
            throw new Error(`${error}`, { cause: error });
        }
    }

    private buildContext(inputMessages: BaseMessage[]): BaseMessage[] {
        return buildContext(this.systemPrompt, this.history.projection, inputMessages);
    }

    private async handleEvents(events: InboundEvent[]) {
        const inputIds = events.map((event) => {
            if (!event.inputId) throw new Error("queued input is missing inputId");
            return event.inputId;
        });
        const turnId = this.createId("turn");
        const turnCreatedAt = Date.now();

        await this.history.append({
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
                    requestId: event.requestId,
                    createdAt: event.createdAt ?? turnCreatedAt,
                });
            }

            await this.emitOutput({ type: "turn_start", turnId, createdAt: turnCreatedAt });

            const inputMessages = events.map((event) => this.createHumanMessage(event));
            const executionInput: ExecutionState = {
                messages: this.buildContext(inputMessages),
                llmCalls: 0,
            };
            // This positional delta assumes final messages retain the baseline as a prefix; compaction must diff by identity.
            const baselineMessageCount = executionInput.messages.length;
            this.executionState = executionInput;

            const finalState = await runAgentStream(this.agent, turnId, executionInput, this.emitOutput.bind(this));
            const completedState = finalState ?? executionInput;
            this.executionState = { messages: completedState.messages, llmCalls: completedState.llmCalls };

            await this.history.append({
                type: "turn.output_committed",
                createdAt: Date.now(),
                turnId,
                messages: serializeHistoryMessages(completedState.messages.slice(baselineMessageCount)),
            });
            outputCommitted = true;

            await this.emitOutput({ type: "done", turnId });
        } catch (error) {
            if (outputCommitted) throw error;

            if (!this.fatalError) {
                await this.history.append({
                    type: "turn.failed",
                    createdAt: Date.now(),
                    turnId,
                    message: normalizeFailureMessage(error),
                });
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
        // A rejected append is already on disk, and replay-on-boot rethrows: writing an event the
        // projection will refuse permanently bricks the runtime. Skip instead of poisoning history.
        if (!this.history.projection.activeTurns.has(turnId)) return;

        await this.history.append({
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
        // Same reason as emitToolStart, plus the projection rejects a completion whose start it
        // never saw -- which is reachable whenever emitToolStart skipped this same tool call.
        if (!this.history.projection.activeToolCalls.get(turnId)?.has(event.toolCallId)) return;

        await this.history.append({
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

function normalizeFailureMessage(error: unknown): string {
    const message = errorMessage(error)
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .replace(/\s+/g, " ")
        .trim();

    if (!message) return "unknown runtime error";
    return message.length > 2_000 ? `${message.slice(0, 2_000)}...` : message;
}
