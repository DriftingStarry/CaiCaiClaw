import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { CompiledStateGraph } from "@langchain/langgraph";
import { JsonObject, JsonValue, toJsonObject } from "@caicaiclaw/protocol";
import { AgentConfig, getAgent, ToolResultEvent, ToolStartEvent } from "./agent.js";

export type MaybePromise<T> = T | Promise<T>;

export type InboundEvent = {
    text: string;
    source?: string;
    createdAt?: number;
    turnId?: string;
};

export type RuntimeState = { messages: BaseMessage[]; llmCalls: number };

export type MessageStreamChunk = readonly [
    message: BaseMessage,
    metadata: Record<string, unknown>,
];

export type RuntimeOutputEvent =
    | {
          readonly type: "input_accepted";
          readonly turnId: string;
          readonly text: string;
          readonly source?: string;
          readonly createdAt: number;
      }
    | {
          readonly type: "turn_start";
          readonly turnId: string;
          readonly createdAt: number;
      }
    | {
          readonly type: "message";
          readonly turnId: string;
          readonly chunk: MessageStreamChunk;
      }
    | {
          readonly type: "assistant_delta";
          readonly turnId: string;
          readonly text: string;
          readonly metadata: JsonObject;
      }
    | {
          readonly type: "reasoning_delta";
          readonly turnId: string;
          readonly text: string;
          readonly metadata: JsonObject;
      }
    | {
          readonly type: "tool_call_start";
          readonly turnId: string;
          readonly toolCallId: string;
          readonly name: string;
          readonly args: JsonObject;
          readonly createdAt: number;
      }
    | {
          readonly type: "tool_call_result";
          readonly turnId: string;
          readonly toolCallId: string;
          readonly name: string;
          readonly status: "success" | "error";
          readonly result: JsonValue;
          readonly createdAt: number;
      }
    | {
          readonly type: "done";
          readonly turnId: string;
      }
    | {
          readonly type: "error";
          readonly turnId?: string;
          readonly error: unknown;
      };

export type AgentRuntimeOptions = {
    heartbeatMs?: number;
    onOutput?: (event: RuntimeOutputEvent) => MaybePromise<void>;
};

type LangGraphMultiStreamChunk =
    | readonly ["messages", MessageStreamChunk]
    | readonly ["values", RuntimeState];

export class AgentRuntime {
    private queue: InboundEvent[] = [];
    private waiters: Array<(events: InboundEvent[]) => void> = [];
    private state: RuntimeState = { messages: [], llmCalls: 0 };
    private readonly agent: CompiledStateGraph<any, any, any, any, any>;
    private running = false;
    private readonly heartbeatMs: number;
    private readonly onOutput?: (event: RuntimeOutputEvent) => MaybePromise<void>;
    private activeTurnId?: string;
    private nextTurnNumber = 1;

    constructor(config: AgentConfig, options?: AgentRuntimeOptions) {
        this.agent = getAgent({
            ...config,
            onToolStart: async (event) => {
                await config.onToolStart?.(event);
                await this.emitToolStart(event);
            },
            onToolResult: async (event) => {
                await config.onToolResult?.(event);
                await this.emitToolResult(event);
            },
        });
        this.heartbeatMs = options?.heartbeatMs ?? 30_000;
        this.onOutput = options?.onOutput;
    }

    public enqueue(evt: InboundEvent) {
        evt.turnId ??= this.createTurnId();
        evt.createdAt ??= Date.now();
        this.queue.push(evt);

        const waiter = this.waiters.shift();
        if (waiter) {
            waiter(this.drain());
        }
    }

    public async run() {
        if (this.running) return;
        this.running = true;

        while (this.running) {
            const events = await this.drainWithin(this.heartbeatMs);

            if (events.length === 0) {
                await this.onHeartbeat();
                continue;
            }

            await this.handleEvents(events);
        }
    }

    public stop() {
        this.running = false;

        const waiter = this.waiters.shift();
        if (waiter) {
            waiter([]);
        }
    }

    public async step() {
        const events = this.drain();
        if (!events.length) throw new Error("no evt to do");
        await this.handleEvents(events);
    }

    private drain(): InboundEvent[] {
        const events = this.queue;
        this.queue = [];
        return events;
    }

    private async drainWithin(timeoutMs: number): Promise<InboundEvent[]> {
        const existing = this.drain();
        if (existing.length > 0) return existing;

        return await new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.waiters = this.waiters.filter((waiter) => waiter !== wake);
                resolve([]);
            }, timeoutMs);

            const wake = (events: InboundEvent[]) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(events);
            };

            this.waiters.push(wake);
        });
    }

    private async handleEvents(events: InboundEvent[]) {
        const turnId = events[0]?.turnId ?? this.createTurnId();
        this.activeTurnId = turnId;

        for (const event of events) {
            await this.emitOutput({
                type: "input_accepted",
                turnId,
                text: event.text,
                source: event.source,
                createdAt: event.createdAt ?? Date.now(),
            });
        }

        await this.emitOutput({ type: "turn_start", turnId, createdAt: Date.now() });

        const inputMessages = events.map((event) => {
            const prefix = event.source ? `[${event.source}] ` : "";
            return new HumanMessage(`${prefix}${event.text}`);
        });

        const inputState: RuntimeState = {
            messages: [...this.state.messages, ...inputMessages],
            llmCalls: 0,
        };

        const finalState = await this.runAgentStream(turnId, inputState);

        this.state = {
            messages: finalState?.messages ?? inputState.messages,
            llmCalls: 0,
        };
        this.activeTurnId = undefined;
    }

    private async onHeartbeat() {
        // P0 keeps heartbeat as a scheduling extension point.
    }

    private async emitOutput(event: RuntimeOutputEvent): Promise<void> {
        await this.onOutput?.(event);
    }

    private async runAgentStream(turnId: string, inputState: RuntimeState): Promise<RuntimeState | undefined> {
        const stream = await this.agent.stream(inputState, {
            streamMode: ["messages", "values"],
        });
        let finalState: RuntimeState | undefined;

        try {
            for await (const chunk of stream as AsyncIterable<LangGraphMultiStreamChunk>) {
                const [mode, payload] = chunk;

                if (mode === "messages") {
                    await this.emitOutput({ type: "message", turnId, chunk: payload });
                    await this.emitMessageDelta(turnId, payload);
                    continue;
                }

                finalState = payload;
            }

            await this.emitOutput({ type: "done", turnId });
            return finalState;
        } catch (error) {
            await this.emitOutput({ type: "error", turnId, error });
            throw error;
        }
    }

    private async emitMessageDelta(turnId: string, chunk: MessageStreamChunk): Promise<void> {
        const [message, metadata] = chunk;
        if (!AIMessage.isInstance(message) && !AIMessageChunk.isInstance(message)) return;

        const text = extractTextContent(message.content);
        if (!text) return;

        await this.emitOutput({
            type: "assistant_delta",
            turnId,
            text,
            metadata: toJsonObject(metadata),
        });
    }

    private async emitToolStart(event: ToolStartEvent): Promise<void> {
        if (!this.activeTurnId) return;

        await this.emitOutput({
            type: "tool_call_start",
            turnId: this.activeTurnId,
            toolCallId: event.toolCallId,
            name: event.name,
            args: event.args,
            createdAt: event.createdAt,
        });
    }

    private async emitToolResult(event: ToolResultEvent): Promise<void> {
        if (!this.activeTurnId) return;

        await this.emitOutput({
            type: "tool_call_result",
            turnId: this.activeTurnId,
            toolCallId: event.toolCallId,
            name: event.name,
            status: event.status,
            result: event.result,
            createdAt: event.createdAt,
        });
    }

    private createTurnId(): string {
        const id = `turn-${this.nextTurnNumber}`;
        this.nextTurnNumber += 1;
        return id;
    }
}

function extractTextContent(content: unknown): string {
    if (typeof content === "string") return content;

    if (!Array.isArray(content)) return "";

    return content
        .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && "text" in item) {
                const text = (item as { text?: unknown }).text;
                return typeof text === "string" ? text : "";
            }
            return "";
        })
        .join("");
}
