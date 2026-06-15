import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import {
    AIMessageChunk,
    type MessageContent,
    type ToolCall,
    type ToolCallChunk,
} from "@langchain/core/messages";
import type { AgentIO, AgentIOEvent } from "./types.js";

type ReasoningKwargs = {
    readonly reasoning_content: unknown;
};

function hasReasoningContent(
    kwargs: Record<string, unknown>,
): kwargs is Record<string, unknown> & ReasoningKwargs {
    return "reasoning_content" in kwargs && kwargs.reasoning_content != null;
}

function contentToText(content: MessageContent): string | undefined {
    if (typeof content === "string") {
        return content.length > 0 ? content : undefined;
    }

    const text = content
        .map((block) => {
            if ("text" in block && typeof block.text === "string") {
                return block.text;
            }
            return "";
        })
        .join("");

    return text.length > 0 ? text : undefined;
}

type ConsoleSection = "none" | "reasoning" | "reply" | "tool";

type CollectedToolCall = {
    readonly name?: string;
    readonly args: string;
};

export class ConsoleIO implements AgentIO {
    private section: ConsoleSection = "none";
    private hasOutput = false;
    private printedToolCallIds = new Set<string>();
    private toolCallChunks = new Map<number, ToolCallChunk[]>();
    private currentGraphNode: string | undefined;

    async readUserInput(prompt: string): Promise<string> {
        this.finishAssistantTurn();
        const rl = createInterface({ input, output });
        try {
            return await rl.question(prompt);
        } finally {
            rl.close();
        }
    }

    emit(event: AgentIOEvent): void {
        switch (event.type) {
            case "message": {
                const [message, metadata] = event.chunk;
                this.flushToolCallsWhenLeavingLlm(metadata);
                if (!AIMessageChunk.isInstance(message)) break;

                if (hasReasoningContent(message.additional_kwargs)) {
                    this.writeReasoning(
                        String(message.additional_kwargs.reasoning_content),
                    );
                }

                const text = contentToText(message.content);
                if (text) {
                    this.writeReply(text);
                }

                if (message.tool_calls?.length) {
                    this.writeToolCalls(message.tool_calls);
                }

                if (message.tool_call_chunks?.length) {
                    this.collectToolCallChunks(message.tool_call_chunks);
                }
                break;
            }
            case "done": {
                this.finishAssistantTurn();
                break;
            }
            case "error": {
                this.startSection("tool");
                console.error("stream error:", event.error);
                this.finishAssistantTurn();
                break;
            }
        }
    }

    private writeReasoning(text: string): void {
        if (text.length === 0) return;
        this.startSection("reasoning");
        process.stdout.write(text);
        this.hasOutput = true;
    }

    private writeReply(text: string): void {
        if (text.length === 0) return;
        this.startSection("reply");
        process.stdout.write(text);
        this.hasOutput = true;
    }

    private writeToolCalls(calls: ToolCall[]): void {
        const completeCalls = calls.filter(
            (call) => Object.keys(call.args).length > 0,
        );

        const newCalls = completeCalls.filter((call, index) => {
            const key = call.id ?? `${call.name}:${index}`;
            if (this.printedToolCallIds.has(key)) return false;
            this.printedToolCallIds.add(key);
            return true;
        });

        if (newCalls.length === 0) return;

        this.startSection("tool");
        for (const call of newCalls) {
            console.log(`- ${call.name}`);
            console.log(JSON.stringify(call.args, null, 2));
        }
        this.hasOutput = true;
        this.toolCallChunks.clear();
    }

    private collectToolCallChunks(chunks: ToolCallChunk[]): void {
        for (const chunk of chunks) {
            if (chunk.index === undefined) continue;
            const current = this.toolCallChunks.get(chunk.index) ?? [];
            current.push(chunk);
            this.toolCallChunks.set(chunk.index, current);
        }
    }

    private flushToolCallsWhenLeavingLlm(
        metadata: Record<string, unknown>,
    ): void {
        const node = metadata.langgraph_node;
        if (typeof node !== "string") return;

        if (this.currentGraphNode === "llm" && node !== "llm") {
            this.flushCollectedToolCallChunks();
            this.toolCallChunks.clear();
        }

        this.currentGraphNode = node;
    }

    private flushCollectedToolCallChunks(): void {
        for (const [index, chunks] of this.toolCallChunks) {
            const name = chunks.find((chunk) => chunk.name)?.name;
            const args = chunks.map((chunk) => chunk.args ?? "").join("");

            if (!name && args.length === 0) continue;

            const calls = this.splitCollectedToolCallArgs(args)
                .filter((callArgs) => !this.isEmptyToolArgs(callArgs))
                .map((callArgs) => ({
                    name,
                    args: callArgs,
                }));

            calls.forEach((call, callIndex) => {
                this.writeCollectedToolCall(call, index, callIndex);
            });
        }
    }

    private writeCollectedToolCall(
        call: CollectedToolCall,
        chunkIndex: number,
        callIndex: number,
    ): void {
        const key = `chunk:${chunkIndex}:${callIndex}:${call.args}`;
        if (this.printedToolCallIds.has(key)) return;
        this.printedToolCallIds.add(key);

        this.startSection("tool");
        console.log(`- ${call.name ?? `tool #${chunkIndex}`}`);
        console.log(this.formatToolArgs(call.args));
        this.hasOutput = true;
    }

    private splitCollectedToolCallArgs(args: string): string[] {
        const trimmed = args.trim();
        if (!trimmed) return [];

        const chunks: string[] = [];
        let start = -1;
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let index = 0; index < trimmed.length; index += 1) {
            const char = trimmed[index];

            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === "\\") {
                escaped = inString;
                continue;
            }

            if (char === "\"") {
                inString = !inString;
                continue;
            }

            if (inString) continue;

            if (char === "{") {
                if (depth === 0) start = index;
                depth += 1;
                continue;
            }

            if (char === "}") {
                depth -= 1;
                if (depth === 0 && start >= 0) {
                    chunks.push(trimmed.slice(start, index + 1));
                    start = -1;
                }
            }
        }

        if (chunks.length === 0) return [trimmed];
        return chunks;
    }

    private formatToolArgs(args: string): string {
        try {
            return JSON.stringify(JSON.parse(args), null, 2);
        } catch {
            return args;
        }
    }

    private isEmptyToolArgs(args: string): boolean {
        try {
            const parsed: unknown = JSON.parse(args);
            return (
                typeof parsed === "object" &&
                parsed !== null &&
                !Array.isArray(parsed) &&
                Object.keys(parsed).length === 0
            );
        } catch {
            return args.trim().length === 0;
        }
    }

    private startSection(next: Exclude<ConsoleSection, "none">): void {
        if (this.section === next) return;

        if (this.section !== "none") {
            process.stdout.write("\n");
        }

        switch (next) {
            case "reasoning":
                process.stdout.write("\n[reasoning]\n");
                break;
            case "reply":
                process.stdout.write("\n[reply]\n");
                break;
            case "tool":
                process.stdout.write("\n[tool]\n");
                break;
        }

        this.section = next;
    }

    private finishAssistantTurn(): void {
        this.flushCollectedToolCallChunks();

        if (!this.hasOutput && this.section === "none") return;

        process.stdout.write("\n");
        this.section = "none";
        this.hasOutput = false;
        this.printedToolCallIds.clear();
        this.toolCallChunks.clear();
        this.currentGraphNode = undefined;
    }
}
