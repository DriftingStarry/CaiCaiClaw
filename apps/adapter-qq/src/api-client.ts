import { z } from "zod";

import type { TokenManager } from "./token-manager";

export type QqSendScope = "group" | "c2c";

export type QqPassiveReplyInput = {
    scope: QqSendScope;
    openid: string;
    content: string;
    msgId: string;
    msgSeq: number;
};

export type QqSendOutcome =
    | { ok: true; messageId: string; timestamp?: string }
    | {
          ok: false;
          kind: "window_expired" | "reply_quota_exhausted" | "rate_limited" | "auth" | "platform" | "transport";
          errCode?: number;
          message: string;
          traceId?: string;
      };

export const QQ_PASSIVE_WINDOW_MS: Record<QqSendScope, number> = {
    group: 5 * 60 * 1000,
    c2c: 60 * 60 * 1000,
};

export const QQ_PASSIVE_MAX_REPLIES: Record<QqSendScope, number> = {
    group: 5,
    c2c: 4,
};

type QqFailureKind = Exclude<Extract<QqSendOutcome, { ok: false }>["kind"], "transport">;

// 官方文档未逐一列出 err_code，具体取值需在真实沙箱联调时校准；未命中时保守归类为 platform。
const QQ_ERROR_CODE_CATEGORIES: Readonly<Record<number, QqFailureKind>> = {};

const qqSuccessResponseSchema = z.object({
    id: z.string(),
    timestamp: z.string().optional(),
    ext_info: z.record(z.string(), z.unknown()).optional(),
});

const qqErrorResponseSchema = z.object({
    err_code: z.number(),
    message: z.string(),
    trace_id: z.string().optional(),
});

export class QqApiClient {
    private readonly tokenManager: TokenManager;
    private readonly apiBaseUrl: string;

    constructor({ tokenManager, apiBaseUrl }: { tokenManager: TokenManager; apiBaseUrl: string }) {
        this.tokenManager = tokenManager;
        this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
    }

    async sendPassiveReply(input: QqPassiveReplyInput): Promise<QqSendOutcome> {
        return this.sendMessage(this.getMessagePath(input.scope, input.openid), {
            msg_type: 0,
            content: input.content,
            msg_id: input.msgId,
            msg_seq: input.msgSeq,
        });
    }

    async sendActiveMessage(input: { scope: QqSendScope; openid: string; content: string }): Promise<QqSendOutcome> {
        return this.sendMessage(this.getMessagePath(input.scope, input.openid), {
            msg_type: 0,
            content: input.content,
        });
    }

    private getMessagePath(scope: QqSendScope, openid: string): string {
        const encodedOpenid = encodeURIComponent(openid);
        return scope === "group" ? `/v2/groups/${encodedOpenid}/messages` : `/v2/users/${encodedOpenid}/messages`;
    }

    private async sendMessage(path: string, body: Record<string, string | number>): Promise<QqSendOutcome> {
        let accessToken: string;
        try {
            accessToken = await this.tokenManager.getToken();
        } catch {
            return {
                ok: false,
                kind: "transport",
                message: "Failed to acquire QQ access token",
            };
        }

        let response: Response;
        try {
            response = await fetch(`${this.apiBaseUrl}${path}`, {
                method: "POST",
                headers: {
                    Authorization: `QQBot ${accessToken}`,
                    "Content-Type": "application/json; charset=utf-8",
                },
                body: JSON.stringify(body),
            });
        } catch {
            return {
                ok: false,
                kind: "transport",
                message: "QQ API request failed",
            };
        }

        let payload: unknown;
        try {
            payload = await response.json();
        } catch {
            return {
                ok: false,
                kind: "platform",
                message: `QQ API returned invalid JSON (HTTP ${response.status})`,
            };
        }

        // 先按 HTTP status 分流：只有 2xx 才允许被解读为成功，避免非 2xx 响应恰好长得像
        // 成功体时被误判，也避免它掉进「invalid response」而丢掉真实 status。
        if (response.ok) {
            // 平台也会在 200 上用 err_code 表达业务失败，成功判定必须先排除它。
            const errorOnSuccessStatus = qqErrorResponseSchema.safeParse(payload);
            if (errorOnSuccessStatus.success && errorOnSuccessStatus.data.err_code !== 0) {
                const { err_code: errCode, message, trace_id: traceId } = errorOnSuccessStatus.data;
                return {
                    ok: false,
                    kind: this.classifyFailure(response.status, errCode, message),
                    errCode,
                    message: this.sanitizeMessage(message, accessToken),
                    ...(traceId === undefined ? {} : { traceId }),
                };
            }

            const successResult = qqSuccessResponseSchema.safeParse(payload);
            if (successResult.success) {
                return {
                    ok: true,
                    messageId: successResult.data.id,
                    ...(successResult.data.timestamp === undefined ? {} : { timestamp: successResult.data.timestamp }),
                };
            }
            return {
                ok: false,
                kind: "platform",
                message: `QQ API returned a 2xx response that is not a valid send result (HTTP ${response.status})`,
            };
        }

        const errorResult = qqErrorResponseSchema.safeParse(payload);
        if (!errorResult.success) {
            return {
                ok: false,
                kind: this.classifyFailure(response.status),
                message: `QQ API returned an invalid response (HTTP ${response.status})`,
            };
        }

        const { err_code: errCode, message, trace_id: traceId } = errorResult.data;
        return {
            ok: false,
            kind: this.classifyFailure(response.status, errCode, message),
            errCode,
            message: this.sanitizeMessage(message, accessToken),
            ...(traceId === undefined ? {} : { traceId }),
        };
    }

    private classifyFailure(status: number, errCode?: number, message?: string): QqFailureKind {
        if (status === 401 || status === 403) {
            return "auth";
        }
        if (status === 429) {
            return "rate_limited";
        }
        if (errCode !== undefined && QQ_ERROR_CODE_CATEGORIES[errCode] !== undefined) {
            return QQ_ERROR_CODE_CATEGORIES[errCode];
        }

        const normalizedMessage = message?.toLowerCase() ?? "";
        if (/rate|too many|频控|频率|限流|过于频繁/.test(normalizedMessage)) {
            return "rate_limited";
        }
        if (
            /unauthor|forbidden|invalid.*token|token.*invalid|access[_ -]?token|鉴权|认证|无权限|权限不足/.test(
                normalizedMessage,
            )
        ) {
            return "auth";
        }
        if (/quota|reply.*limit|limit.*reply|回复.*(次数|上限)|达到.*上限/.test(normalizedMessage)) {
            return "reply_quota_exhausted";
        }
        if (/expired|expire|timeout|timed out|window|过期|超时|回复窗口/.test(normalizedMessage)) {
            return "window_expired";
        }
        return "platform";
    }

    private sanitizeMessage(message: string, accessToken: string): string {
        let sanitizedMessage = message;
        if (accessToken.length > 0) {
            sanitizedMessage = sanitizedMessage.split(accessToken).join("[REDACTED]");
        }
        return sanitizedMessage.replace(
            /(access[_ -]?token|client[_ -]?secret|secret)\s*[:=]\s*["']?[^\s,"'}]+["']?/gi,
            "$1=[REDACTED]",
        );
    }
}
