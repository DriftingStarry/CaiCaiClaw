"use client";

import { Alert, Button, Card, Form, Input, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useEffect, useState } from "react";
import type { DebugReceipt } from "../stores/useAgentClientStore";

type ToolPermission = "L0" | "L1" | "L2" | "L3";

type Props = {
    tools: { name: string; permission: ToolPermission }[];
    receipts: DebugReceipt[];
    onCall: (input: { toolName: string; argsJson: string; dryRun: boolean }) => void;
};

type DebugToolForm = {
    toolName: string;
    argsJson: string;
    dryRun: boolean;
};

export function DebugToolPanel({ tools, receipts, onCall }: Props) {
    const [form] = Form.useForm<DebugToolForm>();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const dryRun = Form.useWatch("dryRun", form) ?? true;

    useEffect(() => {
        const currentToolName = form.getFieldValue("toolName") as string | undefined;
        if (!tools.some((tool) => tool.name === currentToolName)) {
            form.setFieldValue("toolName", tools[0]?.name);
        }
    }, [form, tools]);

    function handleRequestConfirm(): void {
        void form
            .validateFields()
            .then(() => setConfirmOpen(true))
            .catch(() => setConfirmOpen(false));
    }

    function handleFinish(values: DebugToolForm): void {
        onCall(values);
    }

    const toolReceipts = receipts
        .filter((receipt) => receipt.kind === "tool")
        .sort((left, right) => right.createdAt - left.createdAt);

    return (
        <Card className="bg-white/80" title="Debug Outbound Tool Call">
            <Space className="w-full" direction="vertical" size={20}>
                <Alert
                    showIcon
                    type="info"
                    message="出站工具调试说明"
                    description="默认 dry-run 只做 schema 校验与路由解析，不产生真实投递。"
                />
                {!dryRun ? (
                    <Alert
                        showIcon
                        type="warning"
                        message="将真实执行工具"
                        description="将真实执行，仍受权限分级与 L3 审批约束（L3 工具只会创建审批请求，需在上方审批视图批准后才真正投递）。"
                    />
                ) : null}
                <Form
                    form={form}
                    initialValues={{ argsJson: "{}", dryRun: true }}
                    layout="vertical"
                    onFinish={handleFinish}
                >
                    <Form.Item label="工具" name="toolName" rules={[{ required: true, message: "请选择工具" }]}>
                        <Select
                            disabled={tools.length === 0}
                            notFoundContent="暂无已注册工具"
                            options={tools.map((tool) => ({
                                label: (
                                    <Space size={6}>
                                        <span>{tool.name}</span>
                                        <Tag color={permissionColors[tool.permission]}>{tool.permission}</Tag>
                                    </Space>
                                ),
                                value: tool.name,
                            }))}
                            placeholder="暂无已注册工具"
                        />
                    </Form.Item>
                    <Form.Item
                        label="args（JSON 对象）"
                        name="argsJson"
                        rules={[{ required: true, message: "请输入工具参数 JSON" }]}
                    >
                        <Input.TextArea
                            autoSize={{ minRows: 4, maxRows: 10 }}
                            placeholder='例如：{"message":"hello"}'
                        />
                    </Form.Item>
                    <Form.Item label="dry-run" name="dryRun" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Popconfirm
                        title={dryRun ? "确认执行 dry-run？" : "确认真实执行工具？"}
                        description={
                            dryRun
                                ? "本次只会解析路由并校验 schema，不会产生真实投递。"
                                : "本次会真实执行工具；L3 工具会先创建审批请求，批准后才真正投递。"
                        }
                        okText={dryRun ? "确认 dry-run" : "确认真实执行"}
                        cancelText="取消"
                        open={confirmOpen}
                        onConfirm={() => {
                            setConfirmOpen(false);
                            form.submit();
                        }}
                        onCancel={() => setConfirmOpen(false)}
                    >
                        <Button htmlType="button" onClick={handleRequestConfirm} type="primary">
                            {dryRun ? "执行 dry-run" : "真实执行工具"}
                        </Button>
                    </Popconfirm>
                </Form>
                <section aria-labelledby="debug-tool-receipts-title">
                    <Typography.Title className="!mb-3" id="debug-tool-receipts-title" level={4}>
                        工具回执
                    </Typography.Title>
                    <Table<DebugReceipt>
                        columns={receiptColumns}
                        dataSource={toolReceipts}
                        locale={{ emptyText: "暂无工具回执" }}
                        pagination={false}
                        rowKey="requestId"
                        scroll={{ x: 1_120 }}
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
        dataIndex: "permission",
        title: "权限",
        render: (permission?: ToolPermission) =>
            permission ? <Tag color={permissionColors[permission]}>{permission}</Tag> : "—",
    },
    {
        dataIndex: "outcome",
        title: "outcome",
        render: (outcome?: string) =>
            outcome ? (
                <Tag color={outcomeColors[outcome] ?? "default"}>{outcome}</Tag>
            ) : (
                <Typography.Text type="secondary">等待回执</Typography.Text>
            ),
    },
    {
        dataIndex: "approvalId",
        title: "approvalId",
        render: (approvalId?: string) => approvalId ?? "—",
    },
    {
        dataIndex: "detail",
        title: "detail",
        render: (detail?: string) => detail ?? "—",
    },
    {
        dataIndex: "error",
        title: "error",
        render: (error?: string) => (error ? <Typography.Text type="danger">{error}</Typography.Text> : "—"),
    },
];

const permissionColors: Record<ToolPermission, string> = {
    L0: "green",
    L1: "blue",
    L2: "orange",
    L3: "red",
};

const outcomeColors: Record<string, string> = {
    dry_run_ok: "green",
    dry_run_invalid: "orange",
    executed: "green",
    pending_approval: "blue",
    failed: "red",
};
