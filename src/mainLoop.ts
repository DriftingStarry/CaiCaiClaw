import {
    AIMessage,
    AIMessageChunk,
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
import { z } from "zod";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { tools, toolsByName } from "./tools.js";
import { localAgentPrompt } from "./prompts.js";

const model = getOpenrouterModel().bindTools(tools);

const MessageState = new StateSchema({
    messages: MessagesValue,
    llmCalls: new ReducedValue(z.number().default(0), {
        reducer: (x, y) => x + y,
    }),
});

const llm: GraphNode<typeof MessageState> = async (state) => {
    const resp = await model.stream(state.messages);
    let final = new AIMessageChunk({});
    for await (const c of resp) {
        if (c.additional_kwargs.reasoning_content) {
            process.stdout.write(
                c.additional_kwargs.reasoning_content.toString(),
            );
        }
        final = final.concat(c);
    }
    process.stdout.write("\n ai: ");
    for (const { text } of final.content as [{ type: string; text: string }]) {
        process.stdout.write(text);
    }
    return {
        messages: [final],
        llmCalls: 1,
    };
};

const userInput: GraphNode<typeof MessageState> = async (state) => {
    const rl = createInterface({ input, output });
    const line = await rl.question("prompt:");
    rl.close();
    const messages = [];
    if (state.messages.length === 0)
        messages.push(new SystemMessage(localAgentPrompt));
    messages.push(line);
    return {
        messages: messages,
    };
};

const humanRouter: ConditionalEdgeRouter<typeof MessageState, {}, "llm"> = (
    state,
) => {
    const lastMessage = state.messages.at(-1);
    if (!lastMessage || lastMessage?.content === "exit") {
        console.log("to exit");
        return END;
    }
    return "llm";
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
        lastMessage.tool_calls?.length === 0
    ) {
        // last message do not from llm or have not tool call, return human input
        return "userInput";
    }

    return "toolNode";
};

const chat = new StateGraph(MessageState)
    .addNode("llm", llm)
    .addNode("userInput", userInput)
    .addEdge(START, "userInput") // start from user input
    .addConditionalEdges("userInput", humanRouter, ["llm", END]) // based on input to decide whether continue loop
    // .addEdge('llm','userInput')
    .addNode("toolNode", toolNode)
    .addConditionalEdges("llm", toolRouter, ["userInput", "toolNode"]) // llm calls toolNode or returns to human
    .addEdge("toolNode", "llm") // tool results to llm
    .compile();

const resp = await chat.invoke({});
console.log(resp);
