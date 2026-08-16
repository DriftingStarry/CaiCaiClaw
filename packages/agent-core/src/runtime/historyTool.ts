import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolResultPage } from "./types";

const historyReadInputSchema = z.object({
    turnId: z.string().min(1),
    toolCallId: z.string().min(1),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(4_000).default(4_000),
});

export function createHistoryReadTool(readPage: (input: z.infer<typeof historyReadInputSchema>) => ToolResultPage) {
    return new DynamicStructuredTool({
        name: "history_read",
        description: "Read a bounded page of an original long tool result by its history:// turn and tool reference.",
        schema: historyReadInputSchema,
        func: async (input) => JSON.stringify(readPage(input)),
    });
}
