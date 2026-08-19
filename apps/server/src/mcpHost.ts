import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createDynamicTool, type DynamicStructuredTool, type ToolPermissionLevel } from "@caicaiclaw/agent-core";

const MCP_PERMISSION_META_KEY = "com.caicaiclaw/permission";

export type McpToolHostSnapshot = {
    toolsByName: Record<string, DynamicStructuredTool>;
    permissionsByName: Record<string, ToolPermissionLevel>;
    connectedAdapters: string[];
};

type ConnectedAdapter = {
    client: Client;
    tools: Map<string, McpToolDefinition>;
};

type McpToolDefinition = {
    remoteName: string;
    inputSchema: JsonSchema;
    permission?: ToolPermissionLevel;
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
            const permission = isToolPermissionLevel(tool._meta?.[MCP_PERMISSION_META_KEY])
                ? tool._meta[MCP_PERMISSION_META_KEY]
                : undefined;
            tools.set(name, {
                remoteName: tool.name,
                inputSchema: normalizeJsonSchema(tool.inputSchema),
                ...(permission === undefined ? {} : { permission }),
            });
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
        const permissionsByName: Record<string, ToolPermissionLevel> = {};
        for (const [adapterId, adapter] of this.adapters) {
            for (const [name, definition] of adapter.tools) {
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
                if (definition.permission !== undefined) permissionsByName[name] = definition.permission;
            }
        }
        return { toolsByName, permissionsByName, connectedAdapters: [...this.adapters.keys()] };
    }

    /** dry-run 只解析 MCP 路由与输入 schema，不调用 client.callTool，不产生真实投递。 */
    public dryRun(
        toolName: string,
    ): { ok: false; detail: string } | { ok: true; adapterId: string; remoteName: string; inputSchema: JsonSchema } {
        const resolved = this.findToolDefinition(toolName);
        if (!resolved) return { ok: false, detail: `MCP 工具 ${toolName} 不可用` };
        return {
            ok: true,
            adapterId: resolved.adapterId,
            remoteName: resolved.definition.remoteName,
            inputSchema: resolved.definition.inputSchema,
        };
    }

    /** dry-run 参数校验只复用本地 schema 检查，不触发任何 adapter 调用。 */
    public validateArgs(toolName: string, args: Record<string, unknown>): string | undefined {
        const resolved = this.findToolDefinition(toolName);
        if (!resolved) return `MCP 工具 ${toolName} 不可用`;
        return validateJsonSchema(args, resolved.definition.inputSchema, "$args");
    }

    public async close(): Promise<void> {
        const adapterIds = [...this.adapters.keys()];
        for (const adapterId of adapterIds) await this.disconnect(adapterId);
    }

    private findToolDefinition(toolName: string): { adapterId: string; definition: McpToolDefinition } | undefined {
        for (const [adapterId, adapter] of this.adapters) {
            const definition = adapter.tools.get(toolName);
            if (definition) return { adapterId, definition };
        }
        return undefined;
    }
}

function isToolPermissionLevel(value: unknown): value is ToolPermissionLevel {
    return value === "L0" || value === "L1" || value === "L2" || value === "L3";
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
    if (result && typeof result === "object" && "content" in result && Array.isArray(result.content)) {
        const text = result.content
            .map((item) =>
                item && typeof item === "object" && "text" in item && typeof item.text === "string" ? item.text : "",
            )
            .filter(Boolean)
            .join("\n");
        if (text) return text;
    }
    return JSON.stringify(result);
}
