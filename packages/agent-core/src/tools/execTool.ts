import { tool } from "@langchain/core/tools";
import { errorMessage } from "@caicaiclaw/utils";
import child_process from "node:child_process";
import util from "node:util";
import { z } from "zod";

const exec = util.promisify(child_process.exec);
const EXEC_TIMEOUT_MS = 120_000;
const EXEC_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export const execTool = tool(
    async ({ cmd }) => {
        try {
            const { stdout, stderr } = await exec(cmd, {
                timeout: EXEC_TIMEOUT_MS,
                maxBuffer: EXEC_MAX_BUFFER_BYTES,
            });
            return {
                stdout,
                stderr,
            };
        } catch (e) {
            const execError = typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {};
            const code = execError.code;
            return {
                error: errorMessage(e),
                stdout: typeof execError.stdout === "string" ? execError.stdout : "",
                stderr: typeof execError.stderr === "string" ? execError.stderr : "",
                code: typeof code === "string" || typeof code === "number" ? code : null,
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
