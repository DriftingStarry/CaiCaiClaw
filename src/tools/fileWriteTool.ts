import { tool } from "@langchain/core/tools";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod/v4";
import { expandPath } from "./utils.js";

export const fileWriteTool = tool(
    async ({ file_path, content }) => {
        try {
            const fullPath = expandPath(file_path);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, content, "utf8");

            return {
                filePath: fullPath,
                bytesWritten: Buffer.byteLength(content, "utf8"),
            };
        } catch (e) {
            return {
                error: "file write failed",
                detail: e instanceof Error ? e.message : String(e),
            };
        }
    },
    {
        name: "fileWriteTool",
        description:
            "Write a UTF-8 text file to the local filesystem, creating parent directories when needed.",
        schema: z.object({
            file_path: z.string().describe("Absolute or relative path to the file to write"),
            content: z.string().describe("Content to write to the file"),
        }),
    },
);
