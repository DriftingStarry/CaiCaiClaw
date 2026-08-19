import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createDynamicTool, type DynamicStructuredTool } from "@caicaiclaw/agent-core";

export type McpToolHostSnapshot = {
    toolsByName: Record<string, DynamicStructuredTool>;
    connectedAdapters: string[];
};

type ConnectedAdapter = {
    client: Client;
    toolNames: string[];
};

export class McpToolHost {
    private readonly adapters = new Map<string, ConnectedAdapter>();

    public async connect(adapterId: string, transport: Transport): Promise<McpToolHostSnapshot> {
        if (!adapterId.trim()) throw new Error("adapterId must not be empty");
        if (this.adapters.has(adapterId)) throw new Error(`MCP adapter ${adapterId} is already connected`);

        const client = new Client({ name: "caicaiclaw-server", version: "0.0.0" });
        await client.connect(transport);
        const listed = await client.listTools();
        const toolNames: string[] = [];
        for (const tool of listed.tools) {
            const name = namespaceToolName(adapterId, tool.name);
            if (toolNames.includes(name)) throw new Error(`MCP adapter returned duplicate tool ${tool.name}`);
            toolNames.push(name);
        }
        this.adapters.set(adapterId, { client, toolNames });
        return this.snapshot();
    }

    public async disconnect(adapterId: string): Promise<McpToolHostSnapshot> {
        const adapter = this.adapters.get(adapterId);
        if (!adapter) return this.snapshot();
        this.adapters.delete(adapterId);
        await adapter.client.close();
        return this.snapshot();
    }

    public snapshot(): McpToolHostSnapshot {
        const toolsByName: Record<string, DynamicStructuredTool> = {};
        for (const [adapterId, adapter] of this.adapters) {
            for (const name of adapter.toolNames) {
                const toolName = name.slice(`mcp__${adapterId}__`.length);
                toolsByName[name] = createDynamicTool(
                    name,
                    `MCP adapter ${adapterId} tool ${toolName}`,
                    async (args) => {
                        const current = this.adapters.get(adapterId);
                        if (!current) throw new Error(`MCP adapter ${adapterId} is disconnected`);
                        const result = await current.client.callTool({ name: toolName, arguments: args });
                        return normalizeToolResult(result);
                    },
                );
            }
        }
        return { toolsByName, connectedAdapters: [...this.adapters.keys()] };
    }

    public async close(): Promise<void> {
        const adapterIds = [...this.adapters.keys()];
        for (const adapterId of adapterIds) await this.disconnect(adapterId);
    }
}

function namespaceToolName(adapterId: string, toolName: string): string {
    return `mcp__${adapterId}__${toolName}`;
}

function normalizeToolResult(result: unknown): string {
    if (typeof result === "string") return result;
    return JSON.stringify(result);
}
