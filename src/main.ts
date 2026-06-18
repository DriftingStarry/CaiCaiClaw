import { ConsoleIO } from "./io/consoleIO.js";
import { createStreamRuntime } from "./stream.js";
import { getAgent, GetAgentConfig } from "./agent.js";
import { ragAgentPrompt } from "./prompts.js";
import { tools, toolsByName } from "./tools/index.js";

const MAX_STEP_LIMIT = 3;
const LOOP_WARNING_LENGTH = 1;
const io = new ConsoleIO();
const streamRuntime = createStreamRuntime(io);

const config:GetAgentConfig = {
    systemPrompt:ragAgentPrompt,
    MAX_STEP_LIMIT:MAX_STEP_LIMIT,
    LOOP_WARNING_LENGTH:LOOP_WARNING_LENGTH,
    streamRuntime:streamRuntime,
    tools:tools,
    toolsByName:toolsByName
}

const ragAgent = getAgent(config)

const resp = await ragAgent.stream({}, { streamMode: "messages" });

await streamRuntime.consumeMessageStream(resp);
