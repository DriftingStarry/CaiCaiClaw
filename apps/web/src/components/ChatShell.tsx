"use client";

import { Alert, Button, Card, Space, Typography } from "antd";
import { useEffect } from "react";
import { useAgentClientStore } from "../stores/useAgentClientStore.js";

export function ChatShell() {
    const connectionStatus = useAgentClientStore((state) => state.connectionStatus);
    const connect = useAgentClientStore((state) => state.connect);
    const errors = useAgentClientStore((state) => state.errors);

    useEffect(() => {
        connect();
    }, [connect]);

    return (
        <main className="min-h-screen p-4 md:p-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-4">
                <Space direction="vertical" size={4}>
                    <Typography.Title className="!m-0" level={2}>
                        CaiCaiClaw
                    </Typography.Title>
                    <Typography.Text type="secondary">M1 Web observer · {connectionStatus}</Typography.Text>
                </Space>
                {errors.at(-1) ? <Alert type="error" message={errors.at(-1)} showIcon /> : null}
                <Card>
                    <Space direction="vertical">
                        <Typography.Text>Web shell is connected to the shared agent runtime.</Typography.Text>
                        <Button onClick={connect}>Reconnect</Button>
                    </Space>
                </Card>
            </div>
        </main>
    );
}
