"use client";

import { Alert, Space, Typography } from "antd";
import { useEffect } from "react";
import { AdapterPanel } from "../../src/components/AdapterPanel";
import { ApprovalPanel } from "../../src/components/ApprovalPanel";
import { ConnectionBadge } from "../../src/components/ConnectionBadge";
import { DebugToolPanel } from "../../src/components/DebugToolPanel";
import { InjectEventPanel } from "../../src/components/InjectEventPanel";
import { LaneQueuePanel } from "../../src/components/LaneQueuePanel";
import { useAgentClientStore } from "../../src/stores/useAgentClientStore";
import { useAgentSupervisorPolling, useAgentSupervisorStore } from "../../src/stores/useAgentSupervisorStore";

export default function RuntimePage() {
    useAgentSupervisorPolling();
    const clientId = useAgentClientStore((state) => state.clientId);
    const approvalSnapshot = useAgentClientStore((state) => state.approvalSnapshot);
    const decideApproval = useAgentClientStore((state) => state.decideApproval);
    const channelSnapshot = useAgentClientStore((state) => state.channelSnapshot);
    const connectionStatus = useAgentClientStore((state) => state.connectionStatus);
    const connect = useAgentClientStore((state) => state.connect);
    const callDebugTool = useAgentClientStore((state) => state.callDebugTool);
    const debugReceipts = useAgentClientStore((state) => state.debugReceipts);
    const disconnect = useAgentClientStore((state) => state.disconnect);
    const errors = useAgentClientStore((state) => state.errors);
    const injectEvent = useAgentClientStore((state) => state.injectEvent);
    const intakeSnapshot = useAgentClientStore((state) => state.intakeSnapshot);
    const laneSnapshot = useAgentClientStore((state) => state.laneSnapshot);
    const agentStatus = useAgentSupervisorStore((state) => state.snapshot.status);

    useEffect(() => {
        if (agentStatus === "running") connect();
        else disconnect();
        return () => disconnect();
    }, [agentStatus, connect, disconnect]);

    return (
        <main className="min-h-screen p-4 md:p-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-4">
                <header className="flex flex-col justify-between gap-3 rounded-3xl border border-white/60 bg-white/55 p-5 shadow-sm backdrop-blur md:flex-row md:items-end">
                    <Space direction="vertical" size={4}>
                        <Typography.Title className="!m-0" level={2}>
                            Runtime
                        </Typography.Title>
                        <Typography.Text type="secondary">
                            队列 / adapter / 审批视图 · shared AgentRuntime
                        </Typography.Text>
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
                <section className="flex flex-col gap-4">
                    <LaneQueuePanel intakeSnapshot={intakeSnapshot} laneSnapshot={laneSnapshot} />
                    <AdapterPanel channelSnapshot={channelSnapshot} />
                    <ApprovalPanel approvalSnapshot={approvalSnapshot} onDecide={decideApproval} />
                    <InjectEventPanel receipts={debugReceipts} onInject={injectEvent} />
                    <DebugToolPanel
                        tools={channelSnapshot?.tools ?? []}
                        receipts={debugReceipts}
                        onCall={callDebugTool}
                    />
                </section>
            </div>
        </main>
    );
}
