"use client";

import { Alert, Button, Card, Form, Input, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useState } from "react";
import type { DebugReceipt, InjectEventDraft } from "../stores/useAgentClientStore";

type Props = {
    receipts: DebugReceipt[];
    onInject: (draft: InjectEventDraft) => void;
};

type Disposition = NonNullable<DebugReceipt["disposition"]>;

export function InjectEventPanel({ receipts, onInject }: Props) {
    const [form] = Form.useForm<InjectEventDraft>();
    const [confirmOpen, setConfirmOpen] = useState(false);

    function handleFinish(values: InjectEventDraft): void {
        const platformMessageId = values.platformMessageId?.trim();
        onInject({
            ...values,
            ...(platformMessageId ? { platformMessageId } : {}),
            ...(values.laneHint ? { laneHint: values.laneHint } : {}),
        });
    }

    /**
     * 确认弹窗只代表「同意真实入队」，不能替代表单校验：先校验通过再弹确认，
     * 否则用户点了确认才发现必填项没填。校验失败时 antd 已在字段上给出提示。
     */
    function handleRequestConfirm(): void {
        void form
            .validateFields()
            .then(() => setConfirmOpen(true))
            .catch(() => setConfirmOpen(false));
    }

    const sortedReceipts = [...receipts].sort((left, right) => right.createdAt - left.createdAt);

    return (
        <Card className="bg-white/80" title="Inject Inbound Event">
            <Space className="w-full" direction="vertical" size={20}>
                <Alert
                    showIcon
                    type="info"
                    message="入站事件注入说明"
                    description="注入的事件会被服务端强制标记 debugOrigin=admin，并真实进入 runtime 队列，可能触发真实回复投递。"
                />
                <Form form={form} layout="vertical" onFinish={handleFinish} initialValues={{ isSelf: false, text: "" }}>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Form.Item
                            label="channel"
                            name="channel"
                            rules={[{ required: true, message: "请输入 channel" }]}
                        >
                            <Input placeholder="例如 qq" />
                        </Form.Item>
                        <Form.Item
                            label="conversationId"
                            name="conversationId"
                            rules={[{ required: true, message: "请输入 conversationId" }]}
                        >
                            <Input placeholder="例如 qq:group/xxx" />
                        </Form.Item>
                        <Form.Item label="kind" name="kind" rules={[{ required: true, message: "请输入 kind" }]}>
                            <Input placeholder="例如 chat、mention 或 dm" />
                        </Form.Item>
                        <Form.Item
                            label="authorId"
                            name="authorId"
                            rules={[{ required: true, message: "请输入 authorId" }]}
                        >
                            <Input placeholder="例如 debug-user" />
                        </Form.Item>
                        <Form.Item label="platformMessageId（选填）" name="platformMessageId">
                            <Input placeholder="留空则不发送此字段" />
                        </Form.Item>
                        <Form.Item label="laneHint（选填）" name="laneHint">
                            <Select
                                allowClear
                                options={[
                                    { label: "fast", value: "fast" },
                                    { label: "deep", value: "deep" },
                                ]}
                                placeholder="不指定"
                            />
                        </Form.Item>
                    </div>
                    <Form.Item label="text" name="text">
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="事件正文，可为空" />
                    </Form.Item>
                    <Form.Item label="isSelf">
                        <Space align="center">
                            <Form.Item name="isSelf" noStyle valuePropName="checked">
                                <Switch />
                            </Form.Item>
                            <Typography.Text type="secondary">
                                勾选后该事件将被视为机器人自身消息，用于验证回声抑制（预期被 drop，reason=self_echo）
                            </Typography.Text>
                        </Space>
                    </Form.Item>
                    <Popconfirm
                        title="确认注入此事件？"
                        description="这会真实入队，可能触发真实回复投递。"
                        okText="确认注入"
                        cancelText="取消"
                        open={confirmOpen}
                        onConfirm={() => {
                            setConfirmOpen(false);
                            form.submit();
                        }}
                        onCancel={() => setConfirmOpen(false)}
                    >
                        <Button htmlType="button" onClick={handleRequestConfirm} type="primary">
                            注入入站事件
                        </Button>
                    </Popconfirm>
                </Form>
                <section aria-labelledby="debug-injection-receipts-title">
                    <Typography.Title className="!mb-3" id="debug-injection-receipts-title" level={4}>
                        注入回执
                    </Typography.Title>
                    <Table<DebugReceipt>
                        columns={receiptColumns}
                        dataSource={sortedReceipts}
                        locale={{ emptyText: "暂无注入回执" }}
                        pagination={false}
                        rowKey="requestId"
                        scroll={{ x: 920 }}
                        size="small"
                    />
                </section>
            </Space>
        </Card>
    );
}

const receiptColumns: TableColumnsType<DebugReceipt> = [
    {
        dataIndex: "createdAt",
        title: "时间",
        render: (createdAt: number) => new Date(createdAt).toLocaleString(),
    },
    { dataIndex: "label", title: "label" },
    {
        dataIndex: "disposition",
        title: "disposition",
        render: (disposition: DebugReceipt["disposition"]) =>
            disposition ? (
                <Tag color={dispositionColors[disposition]}>{disposition}</Tag>
            ) : (
                <Typography.Text type="secondary">等待回执</Typography.Text>
            ),
    },
    {
        dataIndex: "reason",
        title: "reason",
        render: (reason?: string) => reason ?? "—",
    },
    {
        dataIndex: "batchId",
        title: "batchId",
        render: (batchId?: string) => batchId ?? "—",
    },
    {
        dataIndex: "error",
        title: "error",
        render: (error?: string) => (error ? <Typography.Text type="danger">{error}</Typography.Text> : "—"),
    },
];

const dispositionColors: Record<Disposition, string> = {
    accepted: "success",
    merged: "blue",
    dropped: "error",
};
