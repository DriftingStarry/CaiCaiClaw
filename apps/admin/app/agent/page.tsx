"use client";

import { Alert, Button, Card, Descriptions, Space, Spin, Tag, Typography } from "antd";
import { useAgentSupervisorPolling, useAgentSupervisorStore } from "../../src/stores/useAgentSupervisorStore";
import type { AgentSnapshot } from "../../src/lib/supervisor";

export default function AgentPage() {
    useAgentSupervisorPolling();
    const snapshot = useAgentSupervisorStore((state) => state.snapshot);
    const activeAction = useAgentSupervisorStore((state) => state.activeAction);
    const lastOperation = useAgentSupervisorStore((state) => state.lastOperation);
    const runAction = useAgentSupervisorStore((state) => state.runAction);

    const active = ["starting", "running", "stopping"].includes(snapshot.status);
    const maintenanceAvailable = snapshot.status === "running";
    return (
        <main className="min-h-screen p-4 md:p-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-4">
                <Card title="Agent supervisor">
                    <Space direction="vertical" size="large" className="w-full">
                        <Space wrap>
                            <Typography.Title className="!m-0" level={3}>
                                Agent 状态
                            </Typography.Title>
                            <Tag color={statusColor(snapshot.status)}>{snapshot.status}</Tag>
                            {snapshot.status === "starting" ? <Spin size="small" /> : null}
                        </Space>
                        <Descriptions bordered column={2} size="small">
                            <Descriptions.Item label="PID">{snapshot.pid ?? "—"}</Descriptions.Item>
                            <Descriptions.Item label="启动时间">{snapshot.startedAt ?? "—"}</Descriptions.Item>
                            <Descriptions.Item label="运行时长">
                                {snapshot.uptimeMs === undefined ? "—" : `${Math.floor(snapshot.uptimeMs / 1000)}s`}
                            </Descriptions.Item>
                            <Descriptions.Item label="退出时间">{snapshot.exitedAt ?? "—"}</Descriptions.Item>
                            <Descriptions.Item label="退出码">{snapshot.exitCode ?? "—"}</Descriptions.Item>
                            <Descriptions.Item label="信号">{snapshot.signal ?? "—"}</Descriptions.Item>
                        </Descriptions>
                        {snapshot.error ? (
                            <Alert
                                type={snapshot.status === "crashed" ? "error" : "warning"}
                                message={snapshot.error}
                                showIcon
                            />
                        ) : null}
                        {lastOperation ? (
                            <Alert
                                message={lastOperation.message}
                                showIcon
                                type={lastOperation.outcome === "error" ? "error" : "info"}
                            />
                        ) : null}
                        <Space wrap>
                            <Button
                                disabled={active || Boolean(activeAction)}
                                loading={activeAction === "start"}
                                onClick={() => void runAction("start")}
                                type="primary"
                            >
                                启动
                            </Button>
                            <Button
                                disabled={!active || snapshot.status === "stopping" || Boolean(activeAction)}
                                loading={activeAction === "stop"}
                                onClick={() => void runAction("stop")}
                            >
                                停止
                            </Button>
                            <Button
                                disabled={snapshot.status === "stopping" || Boolean(activeAction)}
                                loading={activeAction === "restart"}
                                onClick={() => void runAction("restart")}
                            >
                                重启
                            </Button>
                            <Button
                                disabled={!maintenanceAvailable || Boolean(activeAction)}
                                loading={activeAction === "compact"}
                                onClick={() => void runAction("compact")}
                            >
                                Compact
                            </Button>
                            <Button
                                disabled={!maintenanceAvailable || Boolean(activeAction)}
                                loading={activeAction === "daydreaming"}
                                onClick={() => void runAction("daydreaming")}
                            >
                                Daydreaming
                            </Button>
                        </Space>
                        {snapshot.status !== "running" ? (
                            <Typography.Text type="secondary">
                                Control WebSocket 尚未收到 hello；维护操作会保持禁用。
                            </Typography.Text>
                        ) : null}
                    </Space>
                </Card>
                <Card title={`stderr（最后 ${snapshot.stderr.length}/200 行）`}>
                    {snapshot.stderr.length ? (
                        <pre className="max-h-[30rem] overflow-auto whitespace-pre-wrap text-xs">
                            {snapshot.stderr.join("\n")}
                        </pre>
                    ) : (
                        <Typography.Text type="secondary">暂无 stderr。</Typography.Text>
                    )}
                </Card>
            </div>
        </main>
    );
}

function statusColor(status: AgentSnapshot["status"]): "default" | "processing" | "success" | "warning" | "error" {
    if (status === "running") return "success";
    if (status === "starting" || status === "stopping") return "processing";
    if (status === "crashed") return "error";
    return "default";
}
