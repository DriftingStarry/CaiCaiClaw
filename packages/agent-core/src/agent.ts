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
    onToolStart?: (event: ToolStartEvent) => MaybePromise<void>;
    onToolResult?: (event: ToolResultEvent) => MaybePromise<void>;
    toolResultMessage?: (event: ToolResultEvent, message: ToolMessage) => ToolMessage;
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
    const { maxStepLimit, loopWarningLength, model, toolsByName, onToolStart, onToolResult, toolResultMessage } =
        config;
    const tools = Object.values(toolsByName);
    const modelWithTools = model.bindTools(tools);

    const llm: GraphNode<typeof MessageState> = async (state) => {
        const context = [...state.messages];
        const { llmCalls } = state;

        if (maxStepLimit - llmCalls <= loopWarningLength) {
            // is going to max loop recursion
            const warning = `warning: is going to max step limit, now step is: ${llmCalls + 1}, max loop limit is ${maxStepLimit}`;
            const firstMessage = context[0];
            if (firstMessage && SystemMessage.isInstance(firstMessage)) {
                context[0] = new SystemMessage(`${String(firstMessage.content)}\n\n${warning}`);
            } else {
                context.unshift(new SystemMessage(warning));
            }
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
                    toolResultMessage?.(
                        {
                            toolCallId,
                            name: call.name,
                            status: "error",
                            result: error,
                            createdAt: Date.now(),
                        },
                        new ToolMessage({
                            content: error,
                            tool_call_id: toolCallId,
                            name: call.name,
                            status: "error",
                        }),
                    ) ??
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
                const rawToolResult = await tool.invoke(call.args);
                const serializedToolResult = toJsonValue(rawToolResult);
                await onToolResult?.({
                    toolCallId,
                    name: call.name,
                    status: "success",
                    result: serializedToolResult,
                    createdAt: Date.now(),
                });
                const toolMessage = new ToolMessage({
                    content: typeof rawToolResult === "string" ? rawToolResult : JSON.stringify(serializedToolResult),
                    tool_call_id: toolCallId,
                    name: call.name,
                });
                res.push(
                    toolResultMessage?.(
                        {
                            toolCallId,
                            name: call.name,
                            status: "success",
                            result: serializedToolResult,
                            createdAt: Date.now(),
                        },
                        toolMessage,
                    ) ?? toolMessage,
                );
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
                    toolResultMessage?.(
                        {
                            toolCallId,
                            name: call.name,
                            status: "error",
                            result: message,
                            createdAt: Date.now(),
                        },
                        new ToolMessage({
                            content: message,
                            tool_call_id: toolCallId,
                            name: call.name,
                            status: "error",
                        }),
                    ) ??
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

    const toolRouter: ConditionalEdgeRouter<typeof MessageState, object, "toolNode"> = (state) => {
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
