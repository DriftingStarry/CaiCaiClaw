import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { CompiledStateGraph } from "@langchain/langgraph";
import { toJsonObject } from "@caicaiclaw/protocol";
import { extractReasoningContent, extractTextContent } from "./messageContent.js";
import { MessageStreamChunk, RuntimeOutputEmitter, RuntimeState } from "./types.js";

type LangGraphMultiStreamChunk =
    | readonly ["messages", MessageStreamChunk]
    | readonly ["values", RuntimeState];

export async function runAgentStream(
    agent: CompiledStateGraph<any, any, any, any, any>,
    turnId: string,
    inputState: RuntimeState,
    emitOutput: RuntimeOutputEmitter,
): Promise<RuntimeState | undefined> {
    const stream = await agent.stream(inputState, {
        streamMode: ["messages", "values"],
    });
    let finalState: RuntimeState | undefined;

    try {
        for await (const chunk of stream as AsyncIterable<LangGraphMultiStreamChunk>) {
            const [mode, payload] = chunk;

            if (mode === "messages") {
                await emitOutput({ type: "message", turnId, chunk: payload });
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
