import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { toJsonObject } from "@caicaiclaw/utils";
import { extractReasoningContent, extractTextContent } from "./messageContent";
import { ExecutionState, MessageStreamChunk, RuntimeOutputEmitter, TurnContext } from "./types";
import { getAgent } from "../agent";

type LangGraphMultiStreamChunk = readonly ["messages", MessageStreamChunk] | readonly ["values", ExecutionState];

export async function runAgentStream(
    agent: ReturnType<typeof getAgent>,
    turnContext: TurnContext,
    inputState: ExecutionState,
    emitOutput: RuntimeOutputEmitter,
): Promise<ExecutionState | undefined> {
    const stream = await agent.stream(inputState, {
        configurable: { turnContext },
        streamMode: ["messages", "values"],
    });
    let finalState: ExecutionState | undefined;

    for await (const chunk of stream as AsyncIterable<LangGraphMultiStreamChunk>) {
        const [mode, payload] = chunk;

        if (mode === "messages") {
            await emitMessageDelta(turnContext, payload, emitOutput);
            continue;
        }

        finalState = payload;
    }

    return finalState;
}

async function emitMessageDelta(
    turnContext: TurnContext,
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
            turnId: turnContext.turnId,
            lane: turnContext.lane,
            text: reasoningText,
            metadata: normalizedMetadata,
        });
    }

    const text = extractTextContent(message.content);
    if (!text) return;

    await emitOutput({
        type: "assistant_delta",
        turnId: turnContext.turnId,
        lane: turnContext.lane,
        text,
        metadata: normalizedMetadata,
        target: turnContext.target,
    });
}
