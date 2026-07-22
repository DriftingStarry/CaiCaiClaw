import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { CompiledStateGraph } from "@langchain/langgraph";
import { AgentConfig, getAgent, ToolResultEvent, ToolStartEvent } from "../agent.js";
import { runAgentStream } from "./agentStream.js";
import { EventQueue } from "./eventQueue.js";
import {
    AgentRuntimeOptions,
    InboundEvent,
    RuntimeOutputEmitter,
    RuntimeOutputEvent,
    RuntimeState,
} from "./types.js";
import {readFileSync } from "node:fs";

export class AgentRuntime {
    private readonly queue = new EventQueue();
    private state: RuntimeState = { messages: [], llmCalls: 0 };
    private readonly agent: CompiledStateGraph<any, any, any, any, any>;
    private running = false;
    private readonly heartbeatMs: number;
    private readonly onOutput?: RuntimeOutputEmitter;
    private activeTurnId?: string;
    private nextTurnNumber = 1;
    private systemPromptPath: string;
    private systemPrompt:string = '';

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

        // init systemPrompt
        this.systemPromptPath = config.systemPromptPath;
        try {
            this.loadSystemPrompt();
        } catch (e) {
            throw Error(`${e}`);
        }

        // setheartbeatMs
        this.heartbeatMs = options?.heartbeatMs ?? 30_000;

        // setOutputHandler
        this.onOutput = options?.onOutput;
    }

    public enqueue(event: InboundEvent) {
        event.turnId ??= this.createTurnId();
        event.createdAt ??= Date.now();
        this.queue.enqueue(event);
    }

    public async run() {
        if (this.running) return;
        this.running = true;

        while (this.running) {
            const events = await this.queue.drainWithin(this.heartbeatMs);

            if (events.length === 0) {
                await this.onHeartbeat();
                continue;
            }

            await this.handleEvents(events);
        }
    }

    public stop() {
        this.running = false;
        this.queue.wakeStopped();
    }

    public async step() {
        const events = this.queue.drain();
        if (!events.length) throw new Error("no evt to do");
        await this.handleEvents(events);
    }

    //todo 更健壮的处理, 文件存在检查, 特殊符号处理, 编码问题, etc..
    public loadSystemPrompt() {
        try {
            const systemPrompt = readFileSync(this.systemPromptPath, 'utf-8')
            this.systemPrompt = systemPrompt;
        } catch (e) {
            throw Error(`${e}`)
        }
    }
    //todo 需要注意对工具调用输出的处理
    // todo 更好的上下文构建策略和更多可配置的参数 (如滑窗长度)
    private buildContext(inputMessages:BaseMessage[]) {
        return [new SystemMessage(this.systemPrompt), ...this.state.messages.slice(1,).slice(-30,) ,...inputMessages]
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
            messages: this.buildContext(inputMessages),
            llmCalls: 0,
        };

        const finalState = await runAgentStream(
            this.agent,
            turnId,
            inputState,
            this.emitOutput.bind(this),
        );

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
