import { DynamicStructuredTool } from "@langchain/core/tools";
import { execTool } from "./execTool.js";
import { fileEditTool } from "./fileEditTool.js";
import { fileReadTool } from "./fileReadTool.js";
import { fileWriteTool } from "./fileWriteTool.js";

export { execTool } from "./execTool.js";
export { fileEditTool } from "./fileEditTool.js";
export { fileReadTool } from "./fileReadTool.js";
export { fileWriteTool } from "./fileWriteTool.js";

export const toolsByName: Record<string, DynamicStructuredTool> = {
    [execTool.name]: execTool,
    [fileReadTool.name]: fileReadTool,
    [fileEditTool.name]: fileEditTool,
    [fileWriteTool.name]: fileWriteTool,
};

export const tools = Object.values(toolsByName);
