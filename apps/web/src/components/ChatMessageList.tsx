"use client";

import { ChatMessage } from "@caicaiclaw/client-core";
import { Empty, Tag, Typography } from "antd";

type ChatMessageListProps = {
    messages: ChatMessage[];
};

export function ChatMessageList({ messages }: ChatMessageListProps) {
    if (!messages.length) {
        return (
            <div className="flex min-h-80 items-center justify-center rounded-3xl border border-dashed border-stone-300 bg-white/45">
                <Empty description="还没有对话，发送一条消息开始观察 agent。" />
            </div>
        );
    }

    return (
        <div className="flex min-h-80 flex-col gap-3 overflow-y-auto pr-1">
            {messages.map((message) => (
                <article
                    className={[
                        "max-w-[88%] rounded-3xl px-4 py-3 shadow-sm",
                        message.role === "user"
                            ? "ml-auto bg-emerald-900 text-white"
                            : "mr-auto border border-stone-200 bg-white/85 text-stone-900",
                    ].join(" ")}
                    key={message.id}
                >
                    <div className="mb-1 flex items-center gap-2">
                        <Typography.Text className={message.role === "user" ? "!text-emerald-50" : undefined} strong>
                            {message.role === "user" ? "You" : "CaiCai"}
                        </Typography.Text>
                        <Tag color={message.status === "error" ? "error" : message.status === "streaming" ? "processing" : "default"}>
                            {message.status}
                        </Tag>
                    </div>
                    <Typography.Paragraph className={message.role === "user" ? "!mb-0 !text-white" : "!mb-0 whitespace-pre-wrap"}>
                        {message.text}
                    </Typography.Paragraph>
                </article>
            ))}
        </div>
    );
}
