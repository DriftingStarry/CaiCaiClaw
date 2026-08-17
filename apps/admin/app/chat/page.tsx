"use client";

import { Alert, Card, Space, Typography } from "antd";
import { useEffect } from "react";
import { AgentActivityPanel } from "../../src/components/AgentActivityPanel";
import { ChatComposer } from "../../src/components/ChatComposer";
import { ChatMessageList } from "../../src/components/ChatMessageList";
import { ConnectionBadge } from "../../src/components/ConnectionBadge";
import { useAgentClientStore } from "../../src/stores/useAgentClientStore";
import { useAgentSupervisorPolling, useAgentSupervisorStore } from "../../src/stores/useAgentSupervisorStore";

export default function ChatPage() {
    useAgentSupervisorPolling();
    const activities = useAgentClientStore((state) => state.activities);
    const clientId = useAgentClientStore((state) => state.clientId);
    const connectionStatus = useAgentClientStore((state) => state.connectionStatus);
    const connect = useAgentClientStore((state) => state.connect);
    const disconnect = useAgentClientStore((state) => state.disconnect);
    const errors = useAgentClientStore((state) => state.errors);
    const messages = useAgentClientStore((state) => state.messages);
    const sendInput = useAgentClientStore((state) => state.sendInput);
    const agentStatus = useAgentSupervisorStore((state) => state.snapshot.status);

    useEffect(() => {
        if (agentStatus === "running") connect();
        else disconnect();
        return () => disconnect();
    }, [agentStatus, connect, disconnect]);

    const connected = agentStatus === "running" && connectionStatus === "connected";
    return (
        <main className="min-h-screen p-4 md:p-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-4">
                <header className="flex flex-col justify-between gap-3 rounded-3xl border border-white/60 bg-white/55 p-5 shadow-sm backdrop-blur md:flex-row md:items-end">
                    <Space direction="vertical" size={4}>
                        <Typography.Title className="!m-0" level={2}>
                            CaiCaiClaw
                        </Typography.Title>
                        <Typography.Text type="secondary">M2 Admin · shared AgentRuntime</Typography.Text>
                    </Space>
                    <ConnectionBadge clientId={clientId} onReconnect={connect} status={connectionStatus} />
                </header>
                {agentStatus !== "running" ? (
                    <Alert
                        message={`agent 当前为 ${agentStatus}`}
                        description="请前往 /agent 启动并等待 control WebSocket hello。"
                        showIcon
                        type="warning"
                    />
                ) : null}
                {errors.at(-1) ? <Alert type="error" message={errors.at(-1)} showIcon /> : null}
                <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
                    <Card className="min-h-[34rem] bg-white/80" title="Chat">
                        <div className="flex min-h-[30rem] flex-col gap-4">
                            <ChatMessageList messages={messages} />
                            <ChatComposer disabled={!connected} onSend={sendInput} />
                        </div>
                    </Card>
                    <AgentActivityPanel activities={activities} />
                </section>
            </div>
        </main>
    );
}
