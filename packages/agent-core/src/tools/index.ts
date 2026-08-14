import { DynamicStructuredTool } from "@langchain/core/tools";
import { execTool } from "./execTool";
import { fileEditTool } from "./fileEditTool";
import { fileReadTool } from "./fileReadTool";
import { fileWriteTool } from "./fileWriteTool";

export { execTool } from "./execTool";
export { fileEditTool } from "./fileEditTool";
export { fileReadTool } from "./fileReadTool";
export { fileWriteTool } from "./fileWriteTool";

export const toolsByName: Record<string, DynamicStructuredTool> = {
    [execTool.name]: execTool,
    [fileReadTool.name]: fileReadTool,
    [fileEditTool.name]: fileEditTool,
    [fileWriteTool.name]: fileWriteTool,
};

export const tools = Object.values(toolsByName);
