"use client";

import type { ClientState } from "@caicaiclaw/client-core";
import { Button, Card, Empty, Popconfirm, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";

type ApprovalSnapshot = NonNullable<ClientState["approvalSnapshot"]>;
type PendingApproval = ApprovalSnapshot["pending"][number];
type DecidedApproval = ApprovalSnapshot["decided"][number];
export type ApprovalDecision = "approve" | "deny";

type Props = {
    approvalSnapshot?: ClientState["approvalSnapshot"];
    onDecide: (approvalId: string, decision: ApprovalDecision) => void;
};

export function ApprovalPanel({ approvalSnapshot, onDecide }: Props) {
    return (
        <Card className="bg-white/80" title="L3 Approvals">
            <Space className="w-full" direction="vertical" size={24}>
                <section aria-labelledby="runtime-pending-approvals-title">
                    <Typography.Title className="!mb-3" id="runtime-pending-approvals-title" level={4}>
                        Pending
                    </Typography.Title>
                    {approvalSnapshot ? (
                        <Table<PendingApproval>
                            columns={pendingColumns(onDecide)}
                            dataSource={approvalSnapshot.pending}
                            pagination={false}
                            rowKey="approvalId"
                            scroll={{ x: 1120 }}
                            size="small"
                        />
                    ) : (
                        <Empty description="approval snapshot 尚未到达" />
                    )}
                </section>

                <section aria-labelledby="runtime-decided-approvals-title">
                    <Typography.Title className="!mb-2" id="runtime-decided-approvals-title" level={4}>
                        Decided History
                    </Typography.Title>
                    <Typography.Text type="secondary">
                        这是近期已决记录（投影有条数上限），完整审计历史在 history.jsonl。
                    </Typography.Text>
                    {approvalSnapshot ? (
                        <Table<DecidedApproval>
                            className="mt-3"
                            columns={decidedColumns}
                            dataSource={approvalSnapshot.decided}
                            pagination={false}
                            rowKey="approvalId"
                            scroll={{ x: 720 }}
                            size="small"
                        />
                    ) : (
                        <Empty className="mt-4" description="approval snapshot 尚未到达" />
                    )}
                </section>
            </Space>
        </Card>
    );
}

function pendingColumns(onDecide: Props["onDecide"]): TableColumnsType<PendingApproval> {
    return [
        { dataIndex: "approvalId", title: "Approval ID" },
        { dataIndex: "turnId", title: "Turn ID" },
        {
            dataIndex: "toolName",
            title: "Tool Name",
            render: (toolName: string) => <Typography.Text code>{toolName}</Typography.Text>,
        },
        {
            dataIndex: "args",
            title: "Args",
            // doneCriteria 要求展示完整 args，因此这里不截断、不折叠，只做换行与横向滚动。
            render: (args: PendingApproval["args"]) => (
                <pre className="m-0 max-w-[32rem] whitespace-pre-wrap break-all rounded-xl bg-stone-50 p-2 text-xs">
                    {JSON.stringify(args, null, 2)}
                </pre>
            ),
        },
        {
            dataIndex: "expiresAt",
            title: "Expires At",
            render: (expiresAt: number) => formatLocalTime(expiresAt),
        },
        {
            title: "Actions",
            render: (_value, record) => (
                <Space wrap>
                    <Popconfirm
                        title="Approve this request?"
                        description="这会真实投递审批决定。"
                        onConfirm={() => onDecide(record.approvalId, "approve")}
                    >
                        <Button type="primary">Approve</Button>
                    </Popconfirm>
                    <Popconfirm
                        title="Deny this request?"
                        description="这会真实投递审批决定。"
                        onConfirm={() => onDecide(record.approvalId, "deny")}
                    >
                        <Button danger>Deny</Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];
}

const decidedColumns: TableColumnsType<DecidedApproval> = [
    { dataIndex: "approvalId", title: "Approval ID" },
    {
        dataIndex: "toolName",
        title: "Tool Name",
        render: (toolName: string) => <Typography.Text code>{toolName}</Typography.Text>,
    },
    {
        dataIndex: "status",
        title: "Status",
        render: (status: DecidedApproval["status"]) => <Tag color={statusColor[status]}>{status}</Tag>,
    },
    {
        dataIndex: "createdAt",
        title: "Created At",
        render: (createdAt: number) => formatLocalTime(createdAt),
    },
];

const statusColor: Record<DecidedApproval["status"], string> = {
    approved: "success",
    denied: "error",
    expired: "warning",
};

function formatLocalTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}
