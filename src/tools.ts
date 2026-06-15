import {
    DynamicStructuredTool,
    tool,
} from "@langchain/core/tools";
import { z } from "zod/v4";
import util from "node:util";
import child_process from "node:child_process";
const exec = util.promisify(child_process.exec);

export const execTool = tool(
    async ({ cmd }) => {
        try {
            const { stdout, stderr } = await exec(cmd);
            return {
                stdout: stdout,
                stderr: stderr,
            };
        } catch (e) {
            return {
                stdout: 'tool exec failed',
                stderr: e
            }
        }
    },
    {
        name: "execTool",
        description: "execute cmd",
        schema: z.object({
            cmd: z
                .string()
                .describe("command to execute, returns cmd stdout and stderr, or exec failaure info"),
        }),
    },
);

export const toolsByName: Record<string, DynamicStructuredTool> = {
    [execTool.name]: execTool,
};

export const tools = Object.values(toolsByName);

