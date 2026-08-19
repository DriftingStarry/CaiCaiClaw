"use client";

import type { ClientState } from "@caicaiclaw/client-core";
import { Badge, Card, Empty, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";

type ChannelSnapshot = NonNullable<ClientState["channelSnapshot"]>;
type Channel = ChannelSnapshot["channels"][number];
type Tool = ChannelSnapshot["tools"][number];
type InboundRate = ChannelSnapshot["inboundRates"][number];
type Outbound = ChannelSnapshot["outbound"][number];

export function AdapterPanel({ channelSnapshot }: { channelSnapshot?: ClientState["channelSnapshot"] }) {
    return (
        <Card className="bg-white/80" title="Adapters">
            <Space className="w-full" direction="vertical" size={24}>
                <section aria-labelledby="runtime-channels-title">
                    <Typography.Title className="!mb-3" id="runtime-channels-title" level={4}>
                        Channels
                    </Typography.Title>
                    {channelSnapshot ? (
                        <Table<Channel>
                            columns={channelColumns}
                            dataSource={channelSnapshot.channels}
                            pagination={false}
                            rowKey="channel"
                            scroll={{ x: 980 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="channel snapshot 尚未到达" />
                    )}
                </section>

                <section aria-labelledby="runtime-tools-title">
                    <Typography.Title className="!mb-3" id="runtime-tools-title" level={4}>
                        Tools
                    </Typography.Title>
                    {channelSnapshot ? (
                        <Table<Tool>
                            columns={toolColumns}
                            dataSource={channelSnapshot.tools}
                            pagination={false}
                            rowKey="name"
                            scroll={{ x: 560 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="channel snapshot 尚未到达" />
                    )}
                </section>

                <section aria-labelledby="runtime-inbound-rates-title">
                    <Typography.Title className="!mb-3" id="runtime-inbound-rates-title" level={4}>
                        Inbound Rates
                    </Typography.Title>
                    {channelSnapshot ? (
                        <Table<InboundRate>
                            columns={inboundRateColumns}
                            dataSource={channelSnapshot.inboundRates}
                            pagination={false}
                            rowKey={(record) => `${record.channel}:${record.windowMs}`}
                            scroll={{ x: 480 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="channel snapshot 尚未到达" />
                    )}
                </section>

                <section aria-labelledby="runtime-outbound-title">
                    <Typography.Title className="!mb-3" id="runtime-outbound-title" level={4}>
                        Outbound
                    </Typography.Title>
                    {channelSnapshot ? (
                        <Table<Outbound>
                            columns={outboundColumns}
                            dataSource={channelSnapshot.outbound}
                            pagination={false}
                            rowKey="toolName"
                            scroll={{ x: 840 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="channel snapshot 尚未到达" />
                    )}
                </section>
            </Space>
        </Card>
    );
}

const channelColumns: TableColumnsType<Channel> = [
    { dataIndex: "channel", title: "Channel" },
    {
        dataIndex: "connected",
        title: "Connected",
        render: (connected: boolean) => (
            <Badge status={connected ? "success" : "default"} text={connected ? "已连接" : "未连接"} />
        ),
    },
    { dataIndex: "selfId", title: "Self ID", render: (selfId?: string) => selfId ?? "—" },
    { dataIndex: "lastReason", title: "Last Reason", render: (lastReason?: string) => lastReason ?? "—" },
    {
        dataIndex: "lastResumable",
        title: "Last Resumable",
        render: (lastResumable?: boolean) =>
            lastResumable === undefined ? "—" : lastResumable ? "可恢复" : "不可恢复",
    },
    {
        dataIndex: "lastChangedAt",
        title: "Last Changed",
        render: (lastChangedAt: number) => formatLocalTime(lastChangedAt),
    },
];

const toolColumns: TableColumnsType<Tool> = [
    {
        dataIndex: "name",
        title: "Name",
        render: (name: string) => <Typography.Text code>{name}</Typography.Text>,
    },
    {
        dataIndex: "permission",
        title: "Permission",
        render: (permission: Tool["permission"]) => <Tag color={permissionColor[permission]}>{permission}</Tag>,
    },
];

const inboundRateColumns: TableColumnsType<InboundRate> = [
    { dataIndex: "channel", title: "Channel" },
    {
        dataIndex: "windowMs",
        title: "Inbound Rate",
        render: (windowMs: number, record) => `${record.count} 条 / ${formatWindow(windowMs)}`,
    },
];

const outboundColumns: TableColumnsType<Outbound> = [
    {
        dataIndex: "toolName",
        title: "Tool Name",
        render: (toolName: string) => <Typography.Text code>{toolName}</Typography.Text>,
    },
    { dataIndex: "delivered", title: "Delivered" },
    { dataIndex: "failed", title: "Failed" },
    { dataIndex: "lastError", title: "Last Error", render: (lastError?: string) => lastError ?? "—" },
    {
        dataIndex: "lastErrorAt",
        title: "Last Error At",
        render: (lastErrorAt?: number) => formatLocalTime(lastErrorAt),
    },
];

const permissionColor: Record<Tool["permission"], string> = {
    L0: "default",
    L1: "blue",
    L2: "orange",
    L3: "red",
};

function formatWindow(windowMs: number): string {
    if (windowMs % 60_000 === 0) return `${windowMs / 60_000}m`;
    if (windowMs % 1_000 === 0) return `${windowMs / 1_000}s`;
    return `${windowMs}ms`;
}

function formatLocalTime(timestamp: number | undefined): string {
    return timestamp === undefined ? "—" : new Date(timestamp).toLocaleString();
}
