"use client";

import type { ClientState } from "@caicaiclaw/client-core";
import { Badge, Card, Empty, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";

type LaneSnapshot = NonNullable<ClientState["laneSnapshot"]>;
type IntakeSnapshot = NonNullable<ClientState["intakeSnapshot"]>;
type Lane = LaneSnapshot["lanes"][number];
type Conversation = IntakeSnapshot["conversations"][number];
type Policy = IntakeSnapshot["policies"][number];

type Props = {
    laneSnapshot?: ClientState["laneSnapshot"];
    intakeSnapshot?: ClientState["intakeSnapshot"];
};

export function LaneQueuePanel({ laneSnapshot, intakeSnapshot }: Props) {
    return (
        <Card className="bg-white/80" title="Lane Queue">
            <Space className="w-full" direction="vertical" size={24}>
                <section aria-labelledby="runtime-lanes-title">
                    <Typography.Title className="!mb-3" id="runtime-lanes-title" level={4}>
                        Lanes
                    </Typography.Title>
                    {laneSnapshot ? (
                        <Table<Lane>
                            columns={laneColumns}
                            dataSource={laneSnapshot.lanes}
                            pagination={false}
                            rowKey={(record) => record.lane}
                            scroll={{ x: 720 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="lane snapshot 尚未到达" />
                    )}
                </section>

                <section aria-labelledby="runtime-conversations-title">
                    <Typography.Title className="!mb-3" id="runtime-conversations-title" level={4}>
                        Conversations
                    </Typography.Title>
                    {intakeSnapshot ? (
                        <Table<Conversation>
                            columns={conversationColumns}
                            dataSource={intakeSnapshot.conversations}
                            pagination={false}
                            rowKey={(record) => `${record.channel}:${record.conversationId}`}
                            scroll={{ x: 1280 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="intake snapshot 尚未到达" />
                    )}
                </section>

                <section aria-labelledby="runtime-policies-title">
                    <Typography.Title className="!mb-3" id="runtime-policies-title" level={4}>
                        Effective Policies
                    </Typography.Title>
                    {intakeSnapshot ? (
                        <Table<Policy>
                            columns={policyColumns}
                            dataSource={intakeSnapshot.policies}
                            pagination={false}
                            rowKey={(record) => `${record.channel}:${record.isDefaults ? "defaults" : "custom"}`}
                            scroll={{ x: 1320 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="intake snapshot 尚未到达" />
                    )}
                </section>
            </Space>
        </Card>
    );
}

const laneColumns: TableColumnsType<Lane> = [
    { dataIndex: "lane", title: "Lane" },
    {
        dataIndex: "busy",
        title: "Status",
        render: (busy: boolean) => <Badge status={busy ? "processing" : "default"} text={busy ? "忙" : "闲"} />,
    },
    { dataIndex: "turnId", title: "Turn ID", render: (turnId?: string) => turnId ?? "—" },
    {
        dataIndex: "conversationId",
        title: "Conversation ID",
        render: (conversationId?: string) => conversationId ?? "—",
    },
    { dataIndex: "queueDepth", title: "Queue Depth" },
];

const conversationColumns: TableColumnsType<Conversation> = [
    { dataIndex: "channel", title: "Channel" },
    { dataIndex: "conversationId", title: "Conversation ID" },
    {
        title: "General Slots",
        render: (_value, record) => `${record.generalPending} / ${record.generalSlots}`,
    },
    {
        title: "Reserved Slots",
        render: (_value, record) => `${record.priorityPending} / ${record.reservedSlots}`,
    },
    { dataIndex: "lane", title: "Lane" },
    { dataIndex: "droppedCount", title: "Dropped" },
    {
        dataIndex: "droppedByReason",
        title: "Dropped by Reason",
        render: (droppedByReason: Conversation["droppedByReason"]) => {
            const reasons = Object.entries(droppedByReason);
            if (reasons.length === 0) return "—";
            return (
                <Space wrap size={[4, 4]}>
                    {reasons.map(([reason, count]) => (
                        <Tag key={reason} color="warning">
                            {reason}×{count}
                        </Tag>
                    ))}
                </Space>
            );
        },
    },
    {
        dataIndex: "oldestReceivedAt",
        title: "Oldest Received",
        render: (oldestReceivedAt: number) => formatLocalTime(oldestReceivedAt),
    },
];

const policyColumns: TableColumnsType<Policy> = [
    {
        dataIndex: "channel",
        title: "Channel",
        render: (channel: string, record) => (
            <Space wrap size={4}>
                <Typography.Text>{record.isDefaults ? "(defaults)" : channel}</Typography.Text>
                {record.isDefaults ? <Tag color="blue">兜底策略</Tag> : null}
            </Space>
        ),
    },
    { dataIndex: "mode", title: "Mode" },
    { dataIndex: "generalSlots", title: "General Slots" },
    { dataIndex: "reservedSlots", title: "Reserved Slots" },
    { dataIndex: "mergeWindowMs", title: "Merge Window (ms)" },
    {
        dataIndex: "alwaysKeep",
        title: "Always Keep",
        render: (alwaysKeep: string[]) => (
            <Space wrap size={[4, 4]}>
                {alwaysKeep.length ? alwaysKeep.map((item) => <Tag key={item}>{item}</Tag>) : "—"}
            </Space>
        ),
    },
    {
        dataIndex: "lane",
        title: "Lane Mapping",
        render: (laneMapping: Policy["lane"]) => (
            <Space wrap size={[4, 4]}>
                {Object.entries(laneMapping).map(([kind, lane]) => (
                    <Tag key={kind}>
                        {kind}: {lane}
                    </Tag>
                ))}
            </Space>
        ),
    },
    {
        title: "Reply",
        render: (_value, record) =>
            `maxChars: ${formatLimit(record.reply.maxChars)} · rateLimitPerMin: ${formatLimit(record.reply.rateLimitPerMin)}`,
    },
];

/** 0 表示不限长 / 不限频，直接渲染 0 会被误读成「禁止回复」。 */
function formatLimit(value: number): string {
    return value === 0 ? "不限" : String(value);
}

function formatLocalTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}
