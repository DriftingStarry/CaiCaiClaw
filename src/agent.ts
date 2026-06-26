import {
    AIMessage,
    HumanMessage,
    SystemMessage,
} from "@langchain/core/messages";
import { getOpenrouterModel } from "./modelProvider.js";
import {
    START,
    END,
    ConditionalEdgeRouter,
    StateGraph,
    StateSchema,
    MessagesValue,
    ReducedValue,
    GraphNode,
} from "@langchain/langgraph";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { StreamRuntime } from "./stream.js";

export interface GetAgentConfig {
    MAX_STEP_LIMIT:number
    LOOP_WARNING_LENGTH:number
    tools:DynamicStructuredTool[]
    toolsByName:Record<string, DynamicStructuredTool>
    streamRuntime:StreamRuntime
    systemPrompt:string
}

const MessageState = new StateSchema({
    messages: MessagesValue,
    llmCalls: new ReducedValue(z.number().default(0), {
        reducer: (x, y) => x + y,
    }),
});

export const getAgent = (config:GetAgentConfig) => {
    const {
        MAX_STEP_LIMIT,
        LOOP_WARNING_LENGTH,
        tools,
        toolsByName,
        systemPrompt
    } = config
    const model = getOpenrouterModel().bindTools(tools);

    const llm: GraphNode<typeof MessageState> = async (state) => {
        const context = [...state.messages];
        const { llmCalls } = state;
        if (systemPrompt) {
            context.unshift(new SystemMessage(systemPrompt))
        } // inject system prompt if have
        if (MAX_STEP_LIMIT - llmCalls <= LOOP_WARNING_LENGTH) {
            // is going to max loop recursion
            context.push(
                new SystemMessage(
                    `warning: is going to max step limit, now step is: ${llmCalls + 1}, max loop limit is ${MAX_STEP_LIMIT}`,
                ),
            );
        } // inject a loop warning
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
            state.llmCalls >= MAX_STEP_LIMIT
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
    return agent
};
