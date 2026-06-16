import type { AgentIO, AgentIOEvent, MessageStreamChunk } from "./io/types.js";

export type LangGraphMessageStream = AsyncIterable<MessageStreamChunk>;

export type StreamRuntimeOptions = {
    readonly primary: AgentIO;
    readonly outputs?: readonly AgentIO[];
};

export type StreamRuntime = {
    readUserInput(prompt: string): Promise<string>;
    consumeMessageStream(stream: LangGraphMessageStream): Promise<void>;
};

export function createStreamRuntime(io: AgentIO): StreamRuntime;
export function createStreamRuntime(options: StreamRuntimeOptions): StreamRuntime;
export function createStreamRuntime(
    ioOrOptions: AgentIO | StreamRuntimeOptions,
): StreamRuntime {
    const { primary, outputs } = normalizeStreamRuntimeOptions(ioOrOptions);

    return {
        readUserInput: (prompt) => primary.readUserInput(prompt),
        consumeMessageStream: (stream) => consumeMessageStream(stream, outputs),
    };
}

function normalizeStreamRuntimeOptions(
    ioOrOptions: AgentIO | StreamRuntimeOptions,
): Required<StreamRuntimeOptions> {
    if ("primary" in ioOrOptions) {
        const outputs = ioOrOptions.outputs ?? [ioOrOptions.primary];
        if (outputs.length === 0) {
            throw new Error("createStreamRuntime requires at least one output IO");
        }

        return {
            primary: ioOrOptions.primary,
            outputs,
        };
    }

    return {
        primary: ioOrOptions,
        outputs: [ioOrOptions],
    };
}

async function consumeMessageStream(
    stream: LangGraphMessageStream,
    outputs: readonly AgentIO[],
): Promise<void> {
    try {
        for await (const chunk of stream) {
            await emitToOutputs(outputs, { type: "message", chunk });
        }

        await emitToOutputs(outputs, { type: "done" });
    } catch (error) {
        try {
            await emitToOutputs(outputs, { type: "error", error });
        } catch {
            // Preserve the stream/emit failure that triggered the error event.
        }

        throw error;
    }
}

async function emitToOutputs(
    outputs: readonly AgentIO[],
    event: AgentIOEvent,
): Promise<void> {
    const results = await Promise.allSettled(
        outputs.map((output) => output.emit(event)),
    );
    const errors = results
        .filter((result): result is PromiseRejectedResult => {
            return result.status === "rejected";
        })
        .map((result) => result.reason);

    if (errors.length === 0) return;
    if (errors.length === 1) throw errors[0];

    throw new AggregateError(errors, "Multiple output IO emit calls failed");
}
