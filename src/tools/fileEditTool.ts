import { tool } from "@langchain/core/tools";
import { promises as fs } from "node:fs";
import { z } from "zod/v4";
import { expandPath, positionToOffset } from "./utils.js";

export const fileEditTool = tool(
    async ({ file_path, start_line, start_column, end_line, end_column, replacement }) => {
        try {
            const fullPath = expandPath(file_path);
            const content = await fs.readFile(fullPath, "utf8");
            const startOffset = positionToOffset(content, start_line, start_column);
            const endOffset = positionToOffset(content, end_line, end_column);

            if (endOffset < startOffset) {
                throw new Error("end position must be after or equal to start position");
            }

            const newContent = content.slice(0, startOffset) + replacement + content.slice(endOffset);
            await fs.writeFile(fullPath, newContent, "utf8");

            return {
                filePath: fullPath,
                start: { line: start_line, column: start_column },
                end: { line: end_line, column: end_column },
                replacement,
                bytesWritten: Buffer.byteLength(newContent, "utf8"),
            };
        } catch (e) {
            return {
                error: "file edit failed",
                detail: e instanceof Error ? e.message : String(e),
            };
        }
    },
    {
        name: "fileEditTool",
        description:
            "Edit a UTF-8 text file by replacing the half-open 1-based line/column range [start, end) with replacement text.",
        schema: z.object({
            file_path: z.string().describe("Absolute or relative path to the file to edit"),
            start_line: z.number().int().positive().describe("1-based start line of the replacement range"),
            start_column: z.number().int().positive().describe("1-based start column of the replacement range"),
            end_line: z.number().int().positive().describe("1-based end line of the replacement range, exclusive"),
            end_column: z.number().int().positive().describe("1-based end column of the replacement range, exclusive"),
            replacement: z.string().describe("Text to insert in place of the selected range"),
        }),
    },
);
