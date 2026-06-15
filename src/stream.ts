import type { AgentIO, MessageStreamChunk } from "./io/types.js";

export type LangGraphMessageStream = AsyncIterable<MessageStreamChunk>;

export type StreamRuntime = {
    readUserInput(prompt: string): Promise<string>;
    consumeMessageStream(stream: LangGraphMessageStream): Promise<void>;
};

export function createStreamRuntime(io: AgentIO): StreamRuntime {
    return {
        readUserInput: (prompt) => io.readUserInput(prompt),
        consumeMessageStream: (stream) => consumeMessageStream(stream, io),
    };
}

async function consumeMessageStream(
    stream: LangGraphMessageStream,
    io: AgentIO,
): Promise<void> {
    try {
        for await (const chunk of stream) {
            await io.emit({ type: "message", chunk });
        }

        await io.emit({ type: "done" });
    } catch (error) {
        await io.emit({ type: "error", error });
        throw error;
    }
}
