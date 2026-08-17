"use client";

import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { useEffect, useState } from "react";

type SettingsResponse = { configured?: boolean; error?: string };

export default function SettingsPage() {
    const [token, setToken] = useState("");
    const [configured, setConfigured] = useState<boolean | undefined>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string>();
    const [error, setError] = useState<string>();

    useEffect(() => {
        let active = true;
        void fetch("/api/agent-auth", { cache: "no-store" })
            .then(async (response) => {
                const body = (await response.json().catch(() => undefined)) as SettingsResponse | undefined;
                if (!response.ok) throw new Error(body?.error ?? "读取设置失败");
                if (active) setConfigured(body?.configured ?? false);
            })
            .catch((reason: unknown) => {
                if (active) setError(reason instanceof Error ? reason.message : "读取设置失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const save = async () => {
        setSaving(true);
        setMessage(undefined);
        setError(undefined);
        try {
            const response = await fetch("/api/agent-auth", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token }),
            });
            const body = (await response.json().catch(() => undefined)) as SettingsResponse | undefined;
            if (!response.ok) throw new Error(body?.error ?? "保存设置失败");
            setConfigured(body?.configured ?? false);
            setToken("");
            setMessage("鉴权密钥已保存；请在 Agent 页面重启 agent 后生效。");
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "保存设置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className="min-h-screen p-4 md:p-8">
            <div className="mx-auto max-w-3xl">
                <Card title="连接设置">
                    <Space direction="vertical" size="large" className="w-full">
                        <Typography.Paragraph type="secondary">
                            Agent WebSocket token 只用于连接鉴权。已保存的密钥不会在设置页回显；留空保存会移除 admin
                            保存的覆盖值并回退到环境配置。
                        </Typography.Paragraph>
                        <Typography.Text>
                            当前状态：{loading ? "读取中" : configured ? "已启用 token 鉴权" : "未启用 token 鉴权"}
                        </Typography.Text>
                        <Input.Password
                            autoComplete="new-password"
                            onChange={(event) => setToken(event.target.value)}
                            placeholder="输入新的 Agent WebSocket token"
                            value={token}
                        />
                        <Button disabled={loading} loading={saving} onClick={() => void save()} type="primary">
                            保存并应用到下次启动
                        </Button>
                        {message ? <Alert message={message} showIcon type="success" /> : null}
                        {error ? <Alert message={error} showIcon type="error" /> : null}
                    </Space>
                </Card>
            </div>
        </main>
    );
}
