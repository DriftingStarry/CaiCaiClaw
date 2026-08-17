"use client";

import { Alert, Button, Card, Input, List, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import type { MemoryDocument } from "../../src/lib/memory";

export default function MemoryPage() {
    const [files, setFiles] = useState<string[]>([]);
    const [selected, setSelected] = useState<string>();
    const [document, setDocument] = useState<MemoryDocument>();
    const [content, setContent] = useState("");
    const [newPath, setNewPath] = useState("tasks/new.md");
    const [message, setMessage] = useState<string>();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadFiles = async () => {
        const response = await fetch("/api/memory", { cache: "no-store" });
        if (!response.ok) throw new Error("无法读取 memory 文件列表");
        const body = (await response.json()) as { files: string[] };
        setFiles(body.files);
        if (!selected && body.files[0]) await selectFile(body.files[0]);
    };

    const selectFile = async (path: string) => {
        setLoading(true);
        setMessage(undefined);
        try {
            const response = await fetch(`/api/memory/${encodePath(path)}`, { cache: "no-store" });
            if (!response.ok) throw new Error("无法读取 memory 文件");
            const body = (await response.json()) as MemoryDocument;
            setSelected(path);
            setDocument(body);
            setContent(body.content);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "读取失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadFiles().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "读取失败"));
    }, []);

    const save = async () => {
        if (!document || !selected) return;
        setSaving(true);
        setMessage(undefined);
        try {
            const response = await fetch(`/api/memory/${encodePath(selected)}`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ content, version: document.version }),
            });
            const body = (await response.json()) as MemoryDocument & { error?: string };
            if (!response.ok) throw new Error(body.error ?? "保存失败");
            setDocument(body);
            setContent(body.content);
            await loadFiles();
            setMessage("保存成功；后续 buildContext() 会读取新内容，无需重启 agent。");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const create = async () => {
        const path = newPath.trim();
        if (!path) return;
        await selectFile(path);
        setDocument({ path, exists: false, content: "", version: { mtimeMs: null, hash: hashEmptyPlaceholder() } });
        setContent("");
        setSelected(path);
    };

    return (
        <main className="min-h-screen p-4 md:p-8">
            <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
                <Card title="Memory files">
                    <Space className="w-full" direction="vertical">
                        <Space.Compact className="w-full">
                            <Input
                                value={newPath}
                                onChange={(event) => setNewPath(event.target.value)}
                                placeholder="tasks/new.md"
                            />
                            <Button onClick={() => void create()}>新建</Button>
                        </Space.Compact>
                        <List
                            dataSource={files}
                            locale={{ emptyText: "暂无 .md 文件" }}
                            renderItem={(path) => (
                                <List.Item
                                    className={path === selected ? "!bg-emerald-50" : "cursor-pointer"}
                                    onClick={() => void selectFile(path)}
                                >
                                    {path}
                                </List.Item>
                            )}
                        />
                    </Space>
                </Card>
                <Card title={selected ?? "选择一个 Markdown 文件"}>
                    {message ? (
                        <Alert
                            className="mb-4"
                            message={message}
                            type={message.includes("成功") ? "success" : "warning"}
                            showIcon
                        />
                    ) : null}
                    {loading ? (
                        <Spin />
                    ) : document ? (
                        <Space className="w-full" direction="vertical" size="middle">
                            <Typography.Text type="secondary">
                                乐观锁版本：mtime {document.version.mtimeMs ?? "missing"}，SHA-256{" "}
                                {document.version.hash}
                            </Typography.Text>
                            <Input.TextArea
                                className="font-mono"
                                minLength={0}
                                onChange={(event) => setContent(event.target.value)}
                                rows={24}
                                value={content}
                            />
                            <Button loading={saving} onClick={() => void save()} type="primary">
                                保存
                            </Button>
                        </Space>
                    ) : (
                        <Typography.Text type="secondary">从左侧选择文件，或创建一个新的 `.md` 文件。</Typography.Text>
                    )}
                </Card>
            </div>
        </main>
    );
}

function encodePath(path: string): string {
    return path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
}

function hashEmptyPlaceholder(): string {
    return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
}
