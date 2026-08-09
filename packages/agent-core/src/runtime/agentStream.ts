import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { toJsonObject } from "@caicaiclaw/utils";
import { extractReasoningContent, extractTextContent } from "./messageContent.js";
import { ExecutionState, MessageStreamChunk, RuntimeOutputEmitter } from "./types.js";
import { getAgent } from "../agent.js";

type LangGraphMultiStreamChunk =
    | readonly ["messages", MessageStreamChunk]
    | readonly ["values", ExecutionState];

export async function runAgentStream(
    agent: ReturnType<typeof getAgent>,
    turnId: string,
    inputState: ExecutionState,
    emitOutput: RuntimeOutputEmitter,
): Promise<ExecutionState | undefined> {
    const stream = await agent.stream(inputState, {
        streamMode: ["messages", "values"],
    });
    let finalState: ExecutionState | undefined;

    try {
        for await (const chunk of stream as AsyncIterable<LangGraphMultiStreamChunk>) {
            const [mode, payload] = chunk;

            if (mode === "messages") {
                await emitMessageDelta(turnId, payload, emitOutput);
                continue;
            }

            finalState = payload;
        }

        return finalState;
    } catch (error) {
        throw error;
    }
}

async function emitMessageDelta(
    turnId: string,
    chunk: MessageStreamChunk,
    emitOutput: RuntimeOutputEmitter,
): Promise<void> {
    const [message, metadata] = chunk;
    if (!AIMessage.isInstance(message) && !AIMessageChunk.isInstance(message)) return;

    const normalizedMetadata = toJsonObject(metadata);
    const reasoningText = extractReasoningContent(message);
    if (reasoningText) {
        await emitOutput({
            type: "reasoning_delta",
            turnId,
            text: reasoningText,
            metadata: normalizedMetadata,
        });
    }

    const text = extractTextContent(message.content);
    if (!text) return;

    await emitOutput({
        type: "assistant_delta",
        turnId,
        text,
        metadata: normalizedMetadata,
    });
}
