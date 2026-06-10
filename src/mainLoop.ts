import {
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

const model = getOpenrouterModel();

const MessageState = new StateSchema({
    messages: MessagesValue,
    llmCalls: new ReducedValue(z.number().default(0), {
        reducer: (x, y) => x + y,
    }),
});

const llm: GraphNode<typeof MessageState> = async (state) => {
    const resp = await model.stream(state.messages)
    let final = new AIMessageChunk({});
    for await (const c of resp) {
        if (c.additional_kwargs.reasoning_content) {
            process.stdout.write(c.additional_kwargs.reasoning_content.toString());
        }
        final = final.concat(c)
    }
    process.stdout.write('\n ai: ')
    for (const {text} of final.content as [{type:string,text:string}]) {
        process.stdout.write(text)
    }
    return {
        messages: [final],
        llmCalls: 1,
    };
};

const userInput: GraphNode<typeof MessageState> = async (state) => {
    const rl = createInterface({ input, output });
    const line = await rl.question("prompt:");
    rl.close()
    const messages = []
    if (state.messages.length === 0) messages.push(new SystemMessage("you are an LLM chat application, named as deepsleep"))
    messages.push(line)
    return {
        messages: messages,
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