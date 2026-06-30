import { ConsoleIO } from "./io/consoleIO.js";
import { GetAgentConfig } from "./agent.js";
import { reactAgentPrompt } from "./prompts.js";
import { tools, toolsByName } from "./tools/index.js";
import { AgentRuntime } from "./runtime.js";

const MAX_STEP_LIMIT = 3;
const LOOP_WARNING_LENGTH = 1;
const io = new ConsoleIO();

const config:GetAgentConfig = {
    systemPrompt:reactAgentPrompt,
    MAX_STEP_LIMIT:MAX_STEP_LIMIT,
    LOOP_WARNING_LENGTH:LOOP_WARNING_LENGTH,
    tools:tools,
    toolsByName:toolsByName
}

const runtime = new AgentRuntime(config)
runtime.addOutput(io)
runtime.run()

while (1) {
    const line = await io.readUserInput('prompt:')
    runtime.enqueue({
        text:line,
        source:'manual',
        createdAt:Date.now()
    })
}
