import { tool } from "@langchain/core/tools";
import { promises as fs } from "node:fs";
import { z } from "zod/v4";
import { addLineNumbers, expandPath } from "./utils.js";

export const fileReadTool = tool(
    async ({ file_path, offset = 1, limit }) => {
        try {
            const fullPath = expandPath(file_path);
            const content = await fs.readFile(fullPath, "utf8");
            const allLines = content.length === 0 ? [] : content.split(/\r\n|\r|\n/);
            const startLine = Math.max(1, offset);
            const endLine = limit === undefined ? allLines.length : Math.min(allLines.length, startLine + limit - 1);
            const selectedLines = allLines.slice(startLine - 1, endLine);
            const selectedContent = selectedLines.join("\n");

            return {
                filePath: fullPath,
                startLine,
                numLines: selectedLines.length,
                totalLines: allLines.length,
                content: addLineNumbers(selectedContent, startLine),
            };
        } catch (e) {
            return {
                error: "file read failed",
                detail: e instanceof Error ? e.message : String(e),
            };
        }
    },
    {
        name: "fileReadTool",
        description:
            "Read a UTF-8 text file from the local filesystem. Returns content with 1-based line numbers in a format suitable for an agent to inspect.",
        schema: z.object({
            file_path: z.string().describe("Absolute or relative path to the text file to read"),
            offset: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("1-based line number to start reading from; defaults to 1"),
            limit: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Maximum number of lines to return"),
        }),
    },
);
