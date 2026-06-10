import {
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

const model = getOpenrouterModel();

const MessageState = new StateSchema({
    messages: MessagesValue,
    llmCalls: new ReducedValue(z.number().default(0), {
        reducer: (x, y) => x + y,
    }),
});

const llm: GraphNode<typeof MessageState> = async (state) => {
    const resp = await model.invoke(state.messages)
    // const resp = new AIMessage(`mock llm resp: ${state.llmCalls}`);
    console.log(resp)
    return {
        messages: [resp],
        llmCalls: 1,
    };
};

const userInput: GraphNode<typeof MessageState> = async (state) => {
    const rl = createInterface({ input, output });
    const line = await rl.question("prompt:");
    rl.close()
    const messages = []
    if (state.messages.length === 0) messages.push(new SystemMessage("you are an LLM chat application, named as deepsleep"))
    return {
        messages: [new HumanMessage(line)],
    };
};

const router:ConditionalEdgeRouter<typeof MessageState, {}, 'llm'> = (state) => {
    const lastMessage = state.messages.at(-1)
    if (!lastMessage || lastMessage?.content === 'exit' ) {
        console.log('to exit')
        return END
    }
    return 'llm'
}

const chat = new StateGraph(MessageState)
    .addNode("llm", llm)
    .addNode("userInput", userInput)
    .addEdge(START,'userInput')
    .addConditionalEdges('userInput', router, ['llm', END])
    .addEdge('llm','userInput')
    .compile();

const resp = await chat.invoke({})
console.log(resp)
console.log()