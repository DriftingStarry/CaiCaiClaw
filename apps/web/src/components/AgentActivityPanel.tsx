"use client";

import { AgentTurnActivity, ToolActivity } from "@caicaiclaw/client-core";
import { Card, Collapse, Empty, Space, Tag, Timeline, Typography } from "antd";

type AgentActivityPanelProps = {
    activities: AgentTurnActivity[];
};

const statusColor = {
    running: "processing",
    done: "success",
    error: "error",
} as const;

const toolStatusColor = {
    running: "processing",
    success: "success",
    error: "error",
} as const;

export function AgentActivityPanel({ activities }: AgentActivityPanelProps) {
    const ordered = [...activities].reverse();

    return (
        <Card className="h-full bg-white/80" title="Agent Activity">
            {!ordered.length ? (
                <Empty description="暂无 reasoning 或 tool 活动" />
            ) : (
                <Timeline
                    items={ordered.map((activity) => ({
                        color: activity.status === "error" ? "red" : activity.status === "done" ? "green" : "blue",
                        children: <TurnActivity activity={activity} />,
                    }))}
                />
            )}
        </Card>
    );
}

function TurnActivity({ activity }: { activity: AgentTurnActivity }) {
    return (
        <Space className="w-full" direction="vertical" size={8}>
            <Space wrap>
                <Typography.Text strong>{activity.turnId}</Typography.Text>
                <Tag color={statusColor[activity.status]}>{activity.status}</Tag>
            </Space>
            <Collapse
                ghost
                items={[
                    {
                        key: "reasoning",
                        label: "Reasoning",
                        children: activity.reasoningText ? (
                            <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">{activity.reasoningText}</Typography.Paragraph>
                        ) : (
                            <Typography.Text type="secondary">Provider 未返回 reasoning 文本。</Typography.Text>
                        ),
                    },
                    {
                        key: "tools",
                        label: `Tools (${activity.tools.length})`,
                        children: activity.tools.length ? (
                            <Space className="w-full" direction="vertical">
                                {activity.tools.map((tool) => (
                                    <ToolCard key={tool.id} tool={tool} />
                                ))}
                            </Space>
                        ) : (
                            <Typography.Text type="secondary">本轮未调用工具。</Typography.Text>
                        ),
                    },
                ]}
                size="small"
            />
        </Space>
    );
}

function ToolCard({ tool }: { tool: ToolActivity }) {
    return (
        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
            <Space className="mb-2" wrap>
                <Typography.Text code>{tool.name}</Typography.Text>
                                <Tag color={toolStatusColor[tool.status]}>{tool.status}</Tag>
            </Space>
            <Typography.Text type="secondary">Args</Typography.Text>
            <pre className="mt-1 max-h-32 overflow-auto rounded-xl bg-white p-2 text-xs">{formatJson(tool.args)}</pre>
            {tool.result !== undefined ? (
                <>
                    <Typography.Text type="secondary">Result</Typography.Text>
                    <pre className="mt-1 max-h-40 overflow-auto rounded-xl bg-white p-2 text-xs">{formatJson(tool.result)}</pre>
                </>
            ) : null}
        </div>
    );
}

function formatJson(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
