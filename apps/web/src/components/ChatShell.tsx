"use client";

import { Alert, Card, Space, Typography } from "antd";
import { useEffect } from "react";
import { useAgentClientStore } from "../stores/useAgentClientStore";
import { AgentActivityPanel } from "./AgentActivityPanel";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { ConnectionBadge } from "./ConnectionBadge";

export function ChatShell() {
    const activities = useAgentClientStore((state) => state.activities);
    const clientId = useAgentClientStore((state) => state.clientId);
    const connectionStatus = useAgentClientStore((state) => state.connectionStatus);
    const connect = useAgentClientStore((state) => state.connect);
    const errors = useAgentClientStore((state) => state.errors);
    const messages = useAgentClientStore((state) => state.messages);
    const sendInput = useAgentClientStore((state) => state.sendInput);

    useEffect(() => {
        connect();
    }, [connect]);

    return (
        <main className="min-h-screen p-4 md:p-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-4">
                <header className="flex flex-col justify-between gap-3 rounded-3xl border border-white/60 bg-white/55 p-5 shadow-sm backdrop-blur md:flex-row md:items-end">
                    <Space direction="vertical" size={4}>
                        <Typography.Title className="!m-0" level={2}>
                            CaiCaiClaw
                        </Typography.Title>
                        <Typography.Text type="secondary">M1 Web observer for the shared AgentRuntime</Typography.Text>
                    </Space>
                    <ConnectionBadge clientId={clientId} onReconnect={connect} status={connectionStatus} />
                </header>
                {errors.at(-1) ? <Alert type="error" message={errors.at(-1)} showIcon /> : null}
                <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
                    <Card className="min-h-[34rem] bg-white/80" title="Chat">
                        <div className="flex min-h-[30rem] flex-col gap-4">
                            <ChatMessageList messages={messages} />
                            <ChatComposer disabled={connectionStatus !== "connected"} onSend={sendInput} />
                        </div>
                    </Card>
                    <AgentActivityPanel activities={activities} />
                </section>
            </div>
        </main>
    );
}
