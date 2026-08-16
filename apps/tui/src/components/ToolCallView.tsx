import { ToolActivity } from "@caicaiclaw/client-core";
import { Box, Text } from "ink";
import React from "react";

export function ToolCallView({ tool }: { tool: ToolActivity }): React.ReactElement {
    const color = tool.status === "success" ? "green" : tool.status === "error" ? "red" : "yellow";
    const preview = tool.result === undefined ? undefined : formatJson(tool.result);
    const lines = preview?.split("\n") ?? [];
    return (
        <Box flexDirection="column">
            <Text>
                <Text color={color}>●</Text> {tool.name}({formatJson(tool.args)})
            </Text>
            {preview ? (
                <Text dimColor>
                    {" "}
                    ⎿ {lines.slice(0, 5).join("\n  ")}
                    {lines.length > 5 ? ` … +${lines.length - 5} lines` : ""}
                </Text>
            ) : null}
        </Box>
    );
}

function formatJson(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
}
