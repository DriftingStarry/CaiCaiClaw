"use client";

import { Alert, Button, Card, Empty, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";

type LogEvent = { lineNumber: number; event: Record<string, unknown> };
type LogGroup = { key: string; turnId?: string; kind: "turn" | "compaction" | "event"; events: LogEvent[] };
type LogPage = {
    exists: boolean;
    groups: LogGroup[];
    errors: string[];
    hasMore: boolean;
    offset: number;
    limit: number;
};

export default function LogsPage() {
    const [page, setPage] = useState<LogPage>({
        exists: true,
        groups: [],
        errors: [],
        hasMore: false,
        offset: 0,
        limit: 10,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();

    const load = useCallback(async (offset: number) => {
        setLoading(true);
        setError(undefined);
        try {
            const response = await fetch(`/api/logs?offset=${offset}&limit=10`, { cache: "no-store" });
            const body = (await response.json()) as LogPage & { error?: string };
            if (!response.ok) throw new Error(body.error ?? "日志读取失败");
            setPage(body);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "日志读取失败");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => void load(0), [load]);
    return (
        <main className="min-h-screen p-4 md:p-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-4">
                <Card
                    title="History logs"
                    extra={
                        <Button loading={loading} onClick={() => void load(page.offset)}>
                            刷新
                        </Button>
                    }
                >
                    {error ? <Alert message={error} type="error" showIcon /> : null}
                    {!page.exists ? (
                        <Empty description="history.jsonl 不存在；agent 启动后会按 runtime 配置创建。" />
                    ) : null}
                    {page.exists && page.groups.length === 0 && !page.errors.length ? (
                        <Empty description="history.jsonl 为空。" />
                    ) : null}
                    {page.errors.length ? (
                        <Alert
                            className="mb-4"
                            description={
                                <ul>
                                    {page.errors.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            }
                            message="日志中有损坏行，已跳过但其余内容仍可展示"
                            type="warning"
                            showIcon
                        />
                    ) : null}
                    <Space className="w-full" direction="vertical">
                        {page.groups.map((group) => (
                            <LogGroupView group={group} key={group.key} />
                        ))}
                    </Space>
                    <Space className="mt-4">
                        <Button
                            disabled={page.offset === 0 || loading}
                            onClick={() => void load(Math.max(0, page.offset - page.limit))}
                        >
                            更新一页
                        </Button>
                        <Button disabled={!page.hasMore || loading} onClick={() => void load(page.offset + page.limit)}>
                            更早的 turns
                        </Button>
                    </Space>
                </Card>
            </div>
        </main>
    );
}

function LogGroupView({ group }: { group: LogGroup }) {
    const title =
        group.kind === "compaction"
            ? `context.compacted ${String(group.events[0]?.event.compactionId ?? "")}`
            : group.turnId
              ? `Turn ${group.turnId}`
              : "未分组事件";
    return (
        <Card
            className="w-full"
            size="small"
            title={
                <Space>
                    <Typography.Text strong>{title}</Typography.Text>
                    <Tag>{group.kind}</Tag>
                </Space>
            }
        >
            <Space className="w-full" direction="vertical">
                {group.events.map((item) => (
                    <EventView item={item} key={`${item.lineNumber}-${String(item.event.eventId)}`} />
                ))}
            </Space>
        </Card>
    );
}

function EventView({ item }: { item: LogEvent }) {
    const event = item.event;
    if (event.type === "tool.completed" && typeof event.turnId === "string" && typeof event.toolCallId === "string") {
        return <ToolResultView event={event} lineNumber={item.lineNumber} />;
    }
    return (
        <details>
            <summary className="cursor-pointer">
                line {item.lineNumber} · {String(event.type)}
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(displayEvent(event), null, 2)}
            </pre>
        </details>
    );
}

function ToolResultView({ event, lineNumber }: { event: Record<string, unknown>; lineNumber: number }) {
    const [result, setResult] = useState<string>();
    const [loading, setLoading] = useState(false);
    const loadResult = async () => {
        setLoading(true);
        const query = new URLSearchParams({
            turnId: String(event.turnId),
            toolCallId: String(event.toolCallId),
            offset: "0",
            limit: "4000",
        });
        const response = await fetch(`/api/logs/result?${query.toString()}`);
        const body = (await response.json()) as { content?: string; error?: string };
        setResult(response.ok ? body.content : (body.error ?? "读取失败"));
        setLoading(false);
    };
    return (
        <details>
            <summary className="cursor-pointer">
                line {lineNumber} · tool.completed · {String(event.name)} ({String(event.resultLength ?? 0)} chars)
            </summary>
            <Space className="mt-2 w-full" direction="vertical">
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                    {String(event.resultPreview ?? "")}
                </pre>
                <Button loading={loading} onClick={() => void loadResult()} size="small">
                    读取结果前 4000 字符
                </Button>
                {result !== undefined ? (
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{result}</pre>
                ) : null}
            </Space>
        </details>
    );
}

function displayEvent(event: Record<string, unknown>): Record<string, unknown> {
    if (event.type !== "context.compacted") return event;
    return {
        ...event,
        summary: event.summary,
        preservedTurns: Array.isArray(event.preservedTurns)
            ? `${event.preservedTurns.length} preserved turns`
            : event.preservedTurns,
    };
}
