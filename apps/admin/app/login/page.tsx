"use client";

import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { useState } from "react";

export default function LoginPage() {
    const [token, setToken] = useState("");
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(false);

    const login = async () => {
        setLoading(true);
        setError(undefined);
        try {
            const response = await fetch("/api/auth", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token }),
            });
            if (!response.ok) throw new Error("token 无效");
            window.location.href = "/chat";
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "认证失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
            <Card className="w-full max-w-md bg-white/85" title="CaiCaiClaw Admin">
                <Space className="w-full" direction="vertical" size="large">
                    <Typography.Text type="secondary">请输入 `CAICAI_ADMIN_TOKEN` 以访问本机管理端。</Typography.Text>
                    {error ? <Alert type="error" message={error} showIcon /> : null}
                    <Input.Password
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        onPressEnter={() => void login()}
                        placeholder="Admin token"
                    />
                    <Button block disabled={!token} loading={loading} onClick={() => void login()} type="primary">
                        登录
                    </Button>
                </Space>
            </Card>
        </main>
    );
}
