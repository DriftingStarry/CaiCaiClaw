import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { HistoryQueryInput, HistoryQueryRecord, ToolResultPage } from "./types";

export const historyQueryInputSchema = z.object({
    conversationId: z.string().min(1).optional(),
    channel: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
    authorId: z.string().min(1).optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(20),
});

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

export function createHistoryQueryTool(query: (input: HistoryQueryInput) => HistoryQueryRecord[]) {
    return new DynamicStructuredTool({
        name: "history_query",
        description: "Query bounded structured channel history by filters and pagination; never reads arbitrary files.",
        schema: historyQueryInputSchema,
        func: async (input) => JSON.stringify(query(input)),
    });
}
