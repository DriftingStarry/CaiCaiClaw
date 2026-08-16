import { ConnectionStatus } from "@caicaiclaw/client-core";
import { Box, Text } from "ink";
import React from "react";
import { connectionColor, connectionLabel } from "../state/selectors";
import { PixelLogo } from "./PixelLogo";

export function HeaderBar({ status }: { status: ConnectionStatus }): React.ReactElement {
    return (
        <Box
            flexDirection="column"
            borderStyle="single"
            borderBottom
            borderTop={false}
            borderLeft={false}
            borderRight={false}
            flexShrink={0}
        >
            <Box>
                <PixelLogo />
                <Box flexDirection="column" marginLeft={1}>
                    <Text bold>CaiCaiClaw Tui</Text>
                    <Text color={connectionColor(status)}>agent {connectionLabel(status)}</Text>
                </Box>
                <Box flexGrow={1} justifyContent="flex-end">
                    <Text dimColor>tab settings</Text>
                </Box>
            </Box>
        </Box>
    );
}
