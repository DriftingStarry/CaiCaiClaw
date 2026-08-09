import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { errorMessage, toJsonObject, toJsonValue } from "@caicaiclaw/utils";
import type { JsonObject, JsonValue, MaybePromise } from "@caicaiclaw/utils";
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

type ToolBindingChatModel = BaseChatModel & {
    bindTools: NonNullable<BaseChatModel["bindTools"]>;
};

export interface AgentConfig {
    maxStepLimit: number;
    loopWarningLength: number;
    model: ToolBindingChatModel;
    toolsByName: Record<string, DynamicStructuredTool>;
    systemPromptPath: string;
    onToolStart?: (event: ToolStartEvent) => MaybePromise<void>;
    onToolResult?: (event: ToolResultEvent) => MaybePromise<void>;
}

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
    const { maxStepLimit, loopWarningLength, model, toolsByName, onToolStart, onToolResult } = config;
    const tools = Object.values(toolsByName);
    const modelWithTools = model.bindTools(tools);

    const llm: GraphNode<typeof MessageState> = async (state) => {
        const context = [...state.messages];
        const { llmCalls } = state;

        if (maxStepLimit - llmCalls <= loopWarningLength) {
            // is going to max loop recursion
            context.push(
                new SystemMessage(
                    `warning: is going to max step limit, now step is: ${llmCalls + 1}, max loop limit is ${maxStepLimit}`,
                ),
            );
        }

        const resp = await modelWithTools.invoke(context);
        return {
            messages: [resp],
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

            if (!tool) {
                const error = `未知工具: ${call.name}`;
                await onToolResult?.({
                    toolCallId,
                    name: call.name,
                    status: "error",
                    result: error,
                    createdAt: Date.now(),
                });
                res.push(
                    new ToolMessage({
                        content: error,
                        tool_call_id: toolCallId,
                        name: call.name,
                        status: "error",
                    }),
                );
                continue;
            }

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
                const message = errorMessage(error);
                await onToolResult?.({
                    toolCallId,
                    name: call.name,
                    status: "error",
                    result: message,
                    createdAt: Date.now(),
                });
                res.push(
                    new ToolMessage({
                        content: message,
                        tool_call_id: toolCallId,
                        name: call.name,
                        status: "error",
                    }),
                );
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
