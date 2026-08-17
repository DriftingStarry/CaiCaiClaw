"use client";

import { Button, Input, Space } from "antd";
import { useState } from "react";

export function ChatComposer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
    const [text, setText] = useState("");
    const submit = () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSend(trimmed);
        setText("");
    };
    return (
        <Space.Compact className="w-full" size="large">
            <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 5 }}
                disabled={disabled}
                onChange={(event) => setText(event.target.value)}
                onPressEnter={(event) => {
                    if (event.shiftKey) return;
                    event.preventDefault();
                    submit();
                }}
                placeholder={disabled ? "等待 agent control 连接..." : "输入消息，Enter 发送，Shift+Enter 换行"}
                value={text}
            />
            <Button disabled={disabled || !text.trim()} onClick={submit} type="primary">
                Send
            </Button>
        </Space.Compact>
    );
}
