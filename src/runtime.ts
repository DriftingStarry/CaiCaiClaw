import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { CompiledStateGraph } from "@langchain/langgraph";
import { getAgent, GetAgentConfig } from "./agent.js";
import type { AgentIO, AgentIOEvent, MessageStreamChunk } from "./io/types.js";

export type InboundEvent = {
    text: string;
    source?: string;
    createdAt?: number;
};

export type RuntimeState = { messages: BaseMessage[]; llmCalls: number };

type LangGraphMultiStreamChunk =
    | readonly ["messages", MessageStreamChunk]
    | readonly ["values", RuntimeState];

export class AgentRuntime {
    private queue: InboundEvent[] = [];
    private waiters: Array<(events: InboundEvent[]) => void> = [];
    private state: RuntimeState = { messages: [], llmCalls: 0 };
    private readonly agent: CompiledStateGraph<any, any, any, any, any>;
    private readonly outputs = new Set<AgentIO>();
    private running = false;
    private readonly heartbeatMs: number;

    constructor(config: GetAgentConfig, options?: { heartbeatMs?: number }) {
        this.agent = getAgent(config);
        this.heartbeatMs = options?.heartbeatMs ?? 30_000;
    }

    public enqueue(evt: InboundEvent) {
        this.queue.push(evt);

        const waiter = this.waiters.shift();
        if (waiter) {
            waiter(this.drain());
        }
    }

    public addOutput(output: AgentIO): () => void {
        this.outputs.add(output);
        return () => {
            this.outputs.delete(output);
        };
    }

    public async emit(event: AgentIOEvent): Promise<void> {
        const results = await Promise.allSettled(
            [...this.outputs].map((output) => output.emit(event)),
        );

        for (const result of results) {
            if (result.status === "rejected") {
                console.error("runtime output emit failed:", result.reason);
                throw new Error(`runtime output emit failed: ${result.reason}`)
            }
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
        const inputMessages = events.map((event) => {
            const prefix = event.source ? `[${event.source}] ` : "";
            return new HumanMessage(`${prefix}${event.text}`);
        });

        const inputState: RuntimeState = {
            messages: [...this.state.messages, ...inputMessages],
            llmCalls: 0,
        };

        const finalState = await this.runAgentStream(inputState);

        this.state = {
            messages: (finalState?.messages ?? inputState.messages),
            llmCalls: 0,
        };
    }

    private async onHeartbeat() {
        // P0 keeps heartbeat as a scheduling extension point.
    }

    private async runAgentStream(
        inputState: RuntimeState,
    ): Promise<RuntimeState | undefined> {
        const stream = await this.agent.stream(inputState, {
            streamMode: ["messages", "values"],
        });
        let finalState: RuntimeState | undefined;

        try {
            for await (const chunk of stream as AsyncIterable<LangGraphMultiStreamChunk>) {
                const [mode, payload] = chunk;

                if (mode === "messages") {
                    await this.emit({ type: "message", chunk: payload });
                    continue;
                }

                finalState = payload;
            }

            await this.emit({ type: "done" });
            return finalState;
        } catch (error) {
            await this.emit({ type: "error", error });
            throw error;
        }
    }
}
