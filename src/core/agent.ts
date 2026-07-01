import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
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
}

const MessageState = new StateSchema({
    messages: MessagesValue,
    llmCalls: new ReducedValue(z.number().default(0), {
        reducer: (x, y) => x + y,
    }),
});

export const getAgent = (config: AgentConfig) => {
    const { maxStepLimit, loopWarningLength, tools, toolsByName, systemPrompt } = config;
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
            const tool_res = await tool.invoke(call);
            res.push(tool_res);
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
