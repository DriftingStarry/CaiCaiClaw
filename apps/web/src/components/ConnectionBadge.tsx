"use client";

import { ConnectionStatus } from "@caicaiclaw/client-core";
import { Badge, Button, Space, Typography } from "antd";

type ConnectionBadgeProps = {
    status: ConnectionStatus;
    clientId?: string;
    onReconnect: () => void;
};

const badgeStatus: Record<ConnectionStatus, "default" | "processing" | "success" | "warning" | "error"> = {
    idle: "default",
    connecting: "processing",
    connected: "success",
    reconnecting: "warning",
    closed: "error",
};

export function ConnectionBadge({ status, clientId, onReconnect }: ConnectionBadgeProps) {
    return (
        <Space align="center" wrap>
            <Badge status={badgeStatus[status]} text={`WS ${status}`} />
            {clientId ? <Typography.Text type="secondary">{clientId}</Typography.Text> : null}
            {status !== "connected" ? (
                <Button size="small" onClick={onReconnect}>
                    Reconnect
                </Button>
            ) : null}
        </Space>
    );
}
