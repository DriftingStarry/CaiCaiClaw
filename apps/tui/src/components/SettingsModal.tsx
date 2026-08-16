import { ConnectionStatus } from "@caicaiclaw/client-core";
import { Box, Text } from "ink";
import React from "react";
import { TextBuffer } from "../hooks/useTextBuffer";
import { connectionLabel } from "../state/selectors";

export function SettingsModal({
    buffer,
    status,
    clientId,
}: {
    buffer: TextBuffer;
    status: ConnectionStatus;
    clientId?: string;
}): React.ReactElement {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold color="cyan">
                Settings
            </Text>
            <Text>
                ws_url: <Text inverse>{buffer.value || " "}</Text>
            </Text>
            <Text dimColor>connection: {connectionLabel(status)}</Text>
            <Text dimColor>client_id: {clientId ?? "(waiting for server)"}</Text>
            <Text dimColor>enter 保存 · esc 取消 · tab 关闭</Text>
        </Box>
    );
}
