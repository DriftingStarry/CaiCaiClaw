import { ConnectionStatus } from "@caicaiclaw/client-core";
import { Box, Text } from "ink";
import React from "react";
import { TextBuffer } from "../hooks/useTextBuffer";
import { connectionLabel } from "../state/selectors";

export function SettingsModal({
    urlBuffer,
    tokenBuffer,
    activeField,
    status,
    clientId,
}: {
    urlBuffer: TextBuffer;
    tokenBuffer: TextBuffer;
    activeField: "url" | "token";
    status: ConnectionStatus;
    clientId?: string;
}): React.ReactElement {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold color="cyan">
                Settings
            </Text>
            <Text>
                ws_url: <Text inverse={activeField === "url"}>{urlBuffer.value || " "}</Text>
            </Text>
            <Text>
                ws_token: <Text inverse={activeField === "token"}>{tokenBuffer.value || " "}</Text>
            </Text>
            <Text dimColor>connection: {connectionLabel(status)}</Text>
            <Text dimColor>client_id: {clientId ?? "(waiting for server)"}</Text>
            <Text dimColor>tab 切换字段 · enter 保存 · esc 取消</Text>
        </Box>
    );
}
