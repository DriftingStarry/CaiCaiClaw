"use client";

import { Alert, Button, Card, Descriptions, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { AgentSnapshot } from "../../src/lib/supervisor";

const initialSnapshot: AgentSnapshot = { status: "stopped", stderr: [], forcedKill: false };

export default function AgentPage() {
    const [snapshot, setSnapshot] = useState<AgentSnapshot>(initialSnapshot);
    const [message, setMessage] = useState<string>();
    const [busy, setBusy] = useState<string>();

    const refresh = useCallback(async () => {
        const response = await fetch("/api/agent", { cache: "no-store" });
        if (response.ok) setSnapshot((await response.json()) as AgentSnapshot);
    }, []);

    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => void refresh(), 1_000);
        return () => window.clearInterval(timer);
    }, [refresh]);

    const act = async (action: string) => {
        setBusy(action);
        setMessage(undefined);
        try {
            const response = await fetch("/api/agent/action", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const body = (await response.json()) as { snapshot?: AgentSnapshot; summary?: string; error?: string };
            if (!response.ok) throw new Error(body.error ?? "操作失败");
            if (body.snapshot) setSnapshot(body.snapshot);
            setMessage(body.summary ? `${action} 完成：${body.summary}` : `${action} 已提交`);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "操作失败");
        } finally {
            setBusy(undefined);
            void refresh();
        }
    };

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
                        {message ? (
                            <Alert
                                message={message}
                                showIcon
                                type={message.includes("失败") || message.includes("cannot") ? "error" : "info"}
                            />
                        ) : null}
                        <Space wrap>
                            <Button
                                disabled={active || (snapshot.status === "stopped" && Boolean(busy))}
                                loading={busy === "start"}
                                onClick={() => void act("start")}
                                type="primary"
                            >
                                启动
                            </Button>
                            <Button
                                disabled={!active || snapshot.status === "stopping"}
                                loading={busy === "stop"}
                                onClick={() => void act("stop")}
                            >
                                停止
                            </Button>
                            <Button
                                disabled={snapshot.status === "stopping" || Boolean(busy)}
                                loading={busy === "restart"}
                                onClick={() => void act("restart")}
                            >
                                重启
                            </Button>
                            <Button
                                disabled={!maintenanceAvailable || Boolean(busy)}
                                loading={busy === "compact"}
                                onClick={() => void act("compact")}
                            >
                                Compact
                            </Button>
                            <Button
                                disabled={!maintenanceAvailable || Boolean(busy)}
                                loading={busy === "daydreaming"}
                                onClick={() => void act("daydreaming")}
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
