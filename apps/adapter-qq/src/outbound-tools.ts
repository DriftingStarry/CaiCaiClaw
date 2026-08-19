import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

import { QQ_PASSIVE_MAX_REPLIES, QQ_PASSIVE_WINDOW_MS, type QqApiClient, type QqSendOutcome } from "./api-client";
import { type ClaimResult, type ReplyWindowTracker } from "./reply-window";

export type QqToolPermission = "L0" | "L1" | "L2" | "L3";

export const QQ_TOOL_PERMISSIONS: Readonly<Record<string, QqToolPermission>> = {
    qq_reply_in_conversation: "L1",
    qq_send_active_message: "L2",
    qq_get_self_identity: "L0",
    qq_send_media_message: "L3",
};

type QqToolResponse = {
    content: [{ type: "text"; text: string }];
    isError?: true;
};

type QqMcpDependencies = {
    apiClient: QqApiClient;
    replyWindow: ReplyWindowTracker;
    selfId: () => string | null;
};

const sendScopeSchema = z.enum(["group", "c2c"]);

function jsonResponse(payload: unknown, isError = false): QqToolResponse {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(payload) ?? "{}",
            },
        ],
        ...(isError ? { isError: true } : {}),
    };
}

function sanitizeErrorMessage(message: string): string {
    return message
        .replace(
            /(access[_ -]?token|client[_ -]?secret|authorization|bearer|password|secret|token)\s*[:=]\s*["']?[^\s,"'}]+["']?/gi,
            "$1=[REDACTED]",
        )
        .replace(/QQBot\s+[A-Za-z0-9._~-]+/gi, "QQBot [REDACTED]");
}

function publicSendOutcome(outcome: QqSendOutcome): Record<string, unknown> {
    if (outcome.ok) {
        return {
            ok: true,
            messageId: outcome.messageId,
            ...(outcome.timestamp === undefined ? {} : { timestamp: outcome.timestamp }),
        };
    }

    return {
        ok: false,
        kind: outcome.kind,
        ...(outcome.errCode === undefined ? {} : { errCode: outcome.errCode }),
        message: sanitizeErrorMessage(outcome.message),
        ...(outcome.traceId === undefined ? {} : { traceId: outcome.traceId }),
    };
}

function isRetryable(outcome: QqSendOutcome): boolean {
    return !outcome.ok && (outcome.kind === "rate_limited" || outcome.kind === "transport");
}

function passiveReplyFailure(input: { msgId: string; claim: ClaimResult; activeFallback: false }): QqToolResponse {
    if (input.claim.ok) {
        return jsonResponse(
            {
                ok: false,
                tool: "qq_reply_in_conversation",
                passive: true,
                activeFallback: input.activeFallback,
                msgId: input.msgId,
                reason: "internal_error",
                detail: "被动回复窗口状态无效",
            },
            true,
        );
    }

    return jsonResponse(
        {
            ok: false,
            tool: "qq_reply_in_conversation",
            passive: true,
            activeFallback: input.activeFallback,
            msgId: input.msgId,
            reason: input.claim.reason,
            detail: input.claim.detail,
        },
        true,
    );
}

export function createQqMcpServer(deps: QqMcpDependencies): McpServer {
    const server = new McpServer({
        name: "caicaiclaw-qq-adapter",
        version: "0.1.0",
    });

    server.registerTool(
        "qq_reply_in_conversation",
        {
            description: "使用已知 QQ 消息的被动回复窗口追加一次回复。窗口或配额不可用时不会改发主动消息。",
            inputSchema: {
                scope: sendScopeSchema,
                openid: z.string().min(1),
                msgId: z.string().min(1),
                content: z.string().min(1),
            },
        },
        async ({ scope, openid, msgId, content }) => {
            const claim = deps.replyWindow.claim(msgId);
            if (!claim.ok) {
                return passiveReplyFailure({ msgId, claim, activeFallback: false });
            }

            try {
                const outcome = await deps.apiClient.sendPassiveReply({
                    scope: claim.scope,
                    openid,
                    msgId,
                    msgSeq: claim.msgSeq,
                    content,
                });

                if (isRetryable(outcome)) {
                    deps.replyWindow.release(msgId, claim.msgSeq);
                }

                return jsonResponse(
                    {
                        ...publicSendOutcome(outcome),
                        tool: "qq_reply_in_conversation",
                        passive: true,
                        activeFallback: false,
                        scope,
                        msgId,
                        msgSeq: claim.msgSeq,
                        replyWindowReleased: isRetryable(outcome),
                    },
                    !outcome.ok,
                );
            } catch {
                deps.replyWindow.release(msgId, claim.msgSeq);
                return jsonResponse(
                    {
                        ok: false,
                        tool: "qq_reply_in_conversation",
                        passive: true,
                        activeFallback: false,
                        scope,
                        msgId,
                        msgSeq: claim.msgSeq,
                        kind: "transport",
                        message: "QQ passive reply request failed",
                        replyWindowReleased: true,
                    },
                    true,
                );
            }
        },
    );

    server.registerTool(
        "qq_send_active_message",
        {
            description: "发送不带 msg_id 的 QQ 主动消息。该动作受主动消息额度限制并需要完整审计。",
            inputSchema: {
                scope: sendScopeSchema,
                openid: z.string().min(1),
                content: z.string().min(1),
            },
        },
        async ({ scope, openid, content }) => {
            try {
                const outcome = await deps.apiClient.sendActiveMessage({ scope, openid, content });
                return jsonResponse(
                    {
                        ...publicSendOutcome(outcome),
                        tool: "qq_send_active_message",
                        active: true,
                        msgIdProvided: false,
                        scope,
                    },
                    !outcome.ok,
                );
            } catch {
                return jsonResponse(
                    {
                        ok: false,
                        tool: "qq_send_active_message",
                        active: true,
                        msgIdProvided: false,
                        scope,
                        kind: "transport",
                        message: "QQ active message request failed",
                    },
                    true,
                );
            }
        },
    );

    server.registerTool(
        "qq_get_self_identity",
        {
            description: "读取 QQ adapter 自身身份与被动回复窗口限制，不发起平台请求。",
        },
        async () =>
            jsonResponse({
                ok: true,
                tool: "qq_get_self_identity",
                selfId: deps.selfId(),
                passiveReplyLimits: {
                    windowMs: QQ_PASSIVE_WINDOW_MS,
                    maxReplies: QQ_PASSIVE_MAX_REPLIES,
                },
            }),
    );

    server.registerTool(
        "qq_send_media_message",
        {
            description: "提交 QQ 富媒体发布动作。当前仅占位并明确返回未实现，不能降级为文本消息。",
            inputSchema: {
                scope: sendScopeSchema,
                openid: z.string().min(1),
                fileInfo: z.string().min(1),
                msgId: z.string().min(1).optional(),
            },
        },
        async ({ scope, openid, msgId }) =>
            jsonResponse(
                {
                    ok: false,
                    tool: "qq_send_media_message",
                    kind: "not_implemented",
                    message: "QQ rich media upload is not implemented",
                    requiredEndpoint: "/v2/groups/{openid}/files",
                    approvalRequired: true,
                    scope,
                    openid,
                    ...(msgId === undefined ? {} : { msgId }),
                    textFallback: false,
                },
                true,
            ),
    );

    return server;
}

export async function startQqMcpServer(server: McpServer, transport: Transport): Promise<void> {
    await server.connect(transport);
}
