import { tool } from "@langchain/core/tools";
import child_process from "node:child_process";
import util from "node:util";
import { z } from "zod/v4";

const exec = util.promisify(child_process.exec);

export const execTool = tool(
    async ({ cmd }) => {
        try {
            const { stdout, stderr } = await exec(cmd);
            return {
                stdout,
                stderr,
            };
        } catch (e) {
            return {
                stdout: "tool exec failed",
                stderr: e,
            };
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
