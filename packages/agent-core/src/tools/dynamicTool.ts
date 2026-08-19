import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export function createDynamicTool(
    name: string,
    description: string,
    execute: (args: Record<string, unknown>) => Promise<unknown>,
): DynamicStructuredTool {
    return new DynamicStructuredTool({
        name,
        description,
        schema: z.object({}).passthrough(),
        func: execute,
    });
}
