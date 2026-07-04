import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { JsonObject, JsonValue } from "@caicaiclaw/protocol";
import {
    ConditionalEdgeRouter,
    END,
    GraphNode,
    MessagesValue,
    ReducedValue,
    START,
    StateGraph,
    StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";
import { getOpenrouterModel } from "./modelProvider.js";

export interface AgentConfig {
    maxStepLimit: number;
    loopWarningLength: number;
    tools: DynamicStructuredTool[];
    toolsByName: Record<string, DynamicStructuredTool>;
    systemPrompt: string;
    onToolStart?: (event: ToolStartEvent) => MaybePromise<void>;
    onToolResult?: (event: ToolResultEvent) => MaybePromise<void>;
}

export type MaybePromise<T> = T | Promise<T>;

export type ToolStartEvent = {
    toolCallId: string;
    name: string;
    args: JsonObject;
    createdAt: number;
};

export type ToolResultEvent = {
    toolCallId: string;
    name: string;
    status: "success" | "error";
    result: JsonValue;
    createdAt: number;
};

const MessageState = new StateSchema({
    messages: MessagesValue,
    llmCalls: new ReducedValue(z.number().default(0), {
        reducer: (x, y) => x + y,
    }),
});

export const getAgent = (config: AgentConfig) => {
    const { maxStepLimit, loopWarningLength, tools, toolsByName, systemPrompt, onToolStart, onToolResult } = config;
    const model = getOpenrouterModel().bindTools(tools);

    const llm: GraphNode<typeof MessageState> = async (state) => {
        const context = [...state.messages];
        const { llmCalls } = state;
        if (systemPrompt) {
            context.unshift(new SystemMessage(systemPrompt));
        }

        if (maxStepLimit - llmCalls <= loopWarningLength) {
            // is going to max loop recursion
            context.push(
                new SystemMessage(
                    `warning: is going to max step limit, now step is: ${llmCalls + 1}, max loop limit is ${maxStepLimit}`,
                ),
            );
        }

        const resp = await model.invoke(context);
        return {
            messages: [new AIMessage(resp)],
            llmCalls: 1,
        };
    };

    const toolNode: GraphNode<typeof MessageState> = async (state) => {
        const lastMessage = state.messages.at(-1);
        if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
            // last message do not from llm, do nothing
            return {};
        }

        const res = [];
        for (const call of lastMessage.tool_calls || []) {
            const tool = toolsByName[call.name];
            const toolCallId = call.id ?? `${call.name}:${Date.now()}`;

            await onToolStart?.({
                toolCallId,
                name: call.name,
                args: toJsonObject(call.args),
                createdAt: Date.now(),
            });

            try {
                const tool_res = await tool.invoke(call);
                await onToolResult?.({
                    toolCallId,
                    name: call.name,
                    status: "success",
                    result: toJsonValue(tool_res),
                    createdAt: Date.now(),
                });
                res.push(tool_res);
            } catch (error) {
                await onToolResult?.({
                    toolCallId,
                    name: call.name,
                    status: "error",
                    result: error instanceof Error ? error.message : String(error),
                    createdAt: Date.now(),
                });
                throw error;
            }
        }
        return { messages: res };
    };

    const toolRouter: ConditionalEdgeRouter<
        typeof MessageState,
        {},
        "userInput" | "toolNode"
    > = (state) => {
        // should be from llm. if have toolcall, returns to tool, if not, returns to human input
        const lastMessage = state.messages.at(-1);
        if (
            !lastMessage ||
            !AIMessage.isInstance(lastMessage) ||
            !lastMessage.tool_calls?.length ||
            state.llmCalls >= maxStepLimit
        ) {
            // last message do not from llm or have not tool call, return human input
            // or exceed max loop recursion
            return END;
        }
        return "toolNode";
    };

    const agent = new StateGraph(MessageState)
        .addNode("llm", llm)
        .addEdge(START, "llm") // directly to llm
        .addNode("toolNode", toolNode)
        .addConditionalEdges("llm", toolRouter, [END, "toolNode"]) // llm calls toolNode or end
        .addEdge("toolNode", "llm") // tool results to llm
        .compile();
    return agent;
};

function toJsonObject(value: unknown): JsonObject {
    const jsonValue = toJsonValue(value);
    return isJsonObject(jsonValue) ? jsonValue : {};
}

function toJsonValue(value: unknown): JsonValue {
    if (value === null) return null;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return Number.isFinite(value) || typeof value !== "number" ? value : String(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => toJsonValue(item));
    }

    if (typeof value === "object") {
        const entries = Object.entries(value).map(([key, entryValue]) => [key, toJsonValue(entryValue)]);
        return Object.fromEntries(entries) as JsonObject;
    }

    return String(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
