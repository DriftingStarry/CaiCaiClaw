import { DynamicStructuredTool, DynamicTool, Tool, tool } from "@langchain/core/tools"
import {z} from 'zod/v4'
import util from 'node:util';
import child_process from 'node:child_process';
const exec = util.promisify(child_process.exec);

export const execTool = tool(
    async ({cmd}) => {
        const {stdout, stderr} = await exec(cmd)
        return {
            stdout:stdout,
            stderr:stderr
        }

    },
    {
        name:'execTool',
        description:'execute cmd',
        schema: z.object({
            cmd:z.string().describe('command to execute, returns cmd stdout and stderr')
        })
    }
)


export const toolsByName:Record<string, DynamicStructuredTool> = {
    [execTool.name]:execTool
}

export const tools= Object.values(toolsByName)

console.log(tools)