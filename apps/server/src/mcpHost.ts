import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createDynamicTool, type DynamicStructuredTool } from "@caicaiclaw/agent-core";

export type McpToolHostSnapshot = {
    toolsByName: Record<string, DynamicStructuredTool>;
    connectedAdapters: string[];
};

type ConnectedAdapter = {
    client: Client;
    tools: Map<string, McpToolDefinition>;
};

type McpToolDefinition = {
    remoteName: string;
    inputSchema: JsonSchema;
};

type JsonSchema = {
    type?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean | JsonSchema;
    items?: JsonSchema;
};

export class McpToolHost {
    private readonly adapters = new Map<string, ConnectedAdapter>();

    public async connect(adapterId: string, transport: Transport): Promise<McpToolHostSnapshot> {
        if (!adapterId.trim()) throw new Error("adapterId must not be empty");
        if (this.adapters.has(adapterId)) throw new Error(`MCP adapter ${adapterId} is already connected`);

        const client = new Client({ name: "caicaiclaw-server", version: "0.0.0" });
        await client.connect(transport);
        const listed = await client.listTools();
        const tools = new Map<string, McpToolDefinition>();
        for (const tool of listed.tools) {
            const name = namespaceToolName(adapterId, tool.name);
            if (tools.has(name)) throw new Error(`MCP adapter returned duplicate tool ${tool.name}`);
            tools.set(name, { remoteName: tool.name, inputSchema: normalizeJsonSchema(tool.inputSchema) });
        }
        this.adapters.set(adapterId, { client, tools });
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
            for (const [name] of adapter.tools) {
                const toolName = name.slice(`mcp__${adapterId}__`.length);
                toolsByName[name] = createDynamicTool(
                    name,
                    `MCP adapter ${adapterId} tool ${toolName}`,
                    async (args) => {
                        const current = this.adapters.get(adapterId);
                        if (!current) throw new Error(`MCP adapter ${adapterId} is disconnected`);
                        const currentDefinition = current.tools.get(name);
                        if (!currentDefinition) throw new Error(`MCP tool ${name} is no longer available`);
                        const validationError = validateJsonSchema(args, currentDefinition.inputSchema, "$args");
                        if (validationError)
                            throw new Error(`invalid arguments for MCP tool ${name}: ${validationError}`);
                        const result = await current.client.callTool({
                            name: currentDefinition.remoteName,
                            arguments: args,
                        });
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

function normalizeJsonSchema(value: unknown): JsonSchema {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("MCP tool inputSchema must be a JSON object");
    }
    return value as JsonSchema;
}

function validateJsonSchema(value: unknown, schema: JsonSchema, path: string): string | undefined {
    if (schema.type === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
        const objectValue = value as Record<string, unknown>;
        for (const required of schema.required ?? []) {
            if (!(required in objectValue)) return `${path}.${required} is required`;
        }
        for (const [key, child] of Object.entries(objectValue)) {
            const childSchema = schema.properties?.[key];
            if (!childSchema) {
                if (schema.additionalProperties === false) return `${path}.${key} is not allowed`;
                if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
                    const error = validateJsonSchema(child, schema.additionalProperties, `${path}.${key}`);
                    if (error) return error;
                }
                continue;
            }
            const error = validateJsonSchema(child, childSchema, `${path}.${key}`);
            if (error) return error;
        }
    } else if (schema.type === "array") {
        if (!Array.isArray(value)) return `${path} must be an array`;
        if (schema.items) {
            for (let index = 0; index < value.length; index += 1) {
                const error = validateJsonSchema(value[index], schema.items, `${path}[${index}]`);
                if (error) return error;
            }
        }
    } else if (schema.type && !matchesJsonType(value, schema.type)) {
        return `${path} must be ${schema.type}`;
    }
    return undefined;
}

function matchesJsonType(value: unknown, type: string): boolean {
    if (type === "null") return value === null;
    if (type === "array") return Array.isArray(value);
    if (type === "object") return Boolean(value && typeof value === "object" && !Array.isArray(value));
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    return typeof value === type;
}

function namespaceToolName(adapterId: string, toolName: string): string {
    return `mcp__${adapterId}__${toolName}`;
}

function normalizeToolResult(result: unknown): string {
    if (typeof result === "string") return result;
    return JSON.stringify(result);
}
