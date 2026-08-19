/**
 * QQ 开放平台 adapter 入口
 *
 * 本进程持有 QQ 机器人的 AppID/AppSecret 与平台长连接，同时提供：
 * - 出站面：MCP server（工具调用）
 * - 入站面：WS client（向 apps/server 投递 ChannelEvent）
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { QqApiClient, type QqSendOutcome, type QqSendScope } from "./api-client";
import { QqGateway } from "./gateway";
import { QqInboundClient } from "./inbound-client";
import { normalizeQqEvent } from "./normalize";
import { createQqMcpServer, startQqMcpServer } from "./outbound-tools";
import { ReplyWindowTracker } from "./reply-window";
import { TokenManager } from "./token-manager";

const QQ_BOT_APP_ID = process.env.QQ_BOT_APP_ID;
const QQ_BOT_CLIENT_SECRET = process.env.QQ_BOT_CLIENT_SECRET;
const QQ_API_BASE_URL = process.env.QQ_API_BASE_URL || "https://api.bot.qq.com";
const QQ_ADAPTER_SERVER_WS_URL = process.env.QQ_ADAPTER_SERVER_WS_URL || "ws://127.0.0.1:8787";
const CAICAI_WS_TOKEN = process.env.CAICAI_WS_TOKEN;

// GROUP_AND_C2C_EVENT 订阅群聊 @ 与 C2C 私聊事件，值为 QQ 平台定义的第 25 位 intent。
const GROUP_AND_C2C_EVENT = 1 << 25;

if (!QQ_BOT_APP_ID || !QQ_BOT_CLIENT_SECRET) {
    console.error("[adapter-qq] Missing required env: QQ_BOT_APP_ID or QQ_BOT_CLIENT_SECRET");
    process.exit(1);
}

// StdioServerTransport 使用 stdout 传输 MCP 协议帧，任何写入 stdout 的日志都会破坏协议帧。
// 因此本进程及其依赖模块一律用 console.error 写 stderr；此处不做全局改写，保持调用点显式可查。

function errorText(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replace(/QQBot\s+\S+/gi, "QQBot [REDACTED]")
        .replace(
            /(access[_ -]?token|client[_ -]?secret|authorization|bearer|password|secret|token)\s*[:=]\s*["']?[^\s,"'}]+["']?/gi,
            "$1=[REDACTED]",
        );
}

type QqOutboundReply = {
    turnId: string;
    lane: string;
    target: { channel: string; conversationId: string; replyTo?: string };
    text: string;
    truncatedFrom?: number;
};

function parseQqConversationId(conversationId: string): { scope: QqSendScope; openid: string } | null {
    const match = /^qq:(group|c2c)\/([^/]+)$/.exec(conversationId);
    if (!match) return null;

    const scopeValue = match[1];
    const openid = match[2];
    if ((scopeValue !== "group" && scopeValue !== "c2c") || !openid) return null;
    const scope: QqSendScope = scopeValue;
    return { scope, openid };
}

async function handleOutboundReply(
    reply: QqOutboundReply,
    apiClient: QqApiClient,
    replyWindow: ReplyWindowTracker,
): Promise<void> {
    const parsedConversation = parseQqConversationId(reply.target.conversationId);
    if (!parsedConversation) {
        console.error(
            `[adapter-qq] Outbound passive reply failed scope=unknown kind=invalid_target reason=invalid conversationId`,
        );
        return;
    }

    const { scope, openid } = parsedConversation;
    const replyTo = reply.target.replyTo;
    if (!replyTo) {
        console.error(
            `[adapter-qq] Outbound passive reply failed scope=${scope} kind=missing_reply_to reason=missing replyTo; active fallback disabled`,
        );
        return;
    }

    const claim = replyWindow.claim(replyTo);
    if (!claim.ok) {
        console.error(
            `[adapter-qq] Outbound passive reply failed scope=${scope} kind=${claim.reason} reason=${errorText(claim.detail)}; active fallback disabled`,
        );
        return;
    }

    if (claim.scope !== scope) {
        console.error(
            `[adapter-qq] Passive reply scope mismatch target=${scope} registered=${claim.scope}; using registered scope=${claim.scope}`,
        );
    }

    let outcome: QqSendOutcome;
    try {
        outcome = await apiClient.sendPassiveReply({
            scope: claim.scope,
            openid,
            msgId: replyTo,
            msgSeq: claim.msgSeq,
            content: reply.text,
        });
    } catch (error) {
        replyWindow.release(replyTo, claim.msgSeq);
        console.error(
            `[adapter-qq] Outbound passive reply failed scope=${claim.scope} kind=transport reason=${errorText(error)}; active fallback disabled`,
        );
        return;
    }

    if (outcome.ok) return;
    if (outcome.kind === "rate_limited" || outcome.kind === "transport") {
        replyWindow.release(replyTo, claim.msgSeq);
    }
    console.error(
        `[adapter-qq] Outbound passive reply failed scope=${claim.scope} kind=${outcome.kind} reason=${errorText(outcome.message)}; active fallback disabled`,
    );
}

let selfId: string | null = null;
let gateway: QqGateway | undefined;
let inbound: QqInboundClient | undefined;
let shuttingDown = false;

const tokenManager = new TokenManager({
    appId: QQ_BOT_APP_ID,
    clientSecret: QQ_BOT_CLIENT_SECRET,
    apiBaseUrl: QQ_API_BASE_URL,
});

function shutdown(exitCode: number): void {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    console.error("[adapter-qq] Shutting down...");
    gateway?.close();
    inbound?.close();
    tokenManager.stop();
    process.exit(exitCode);
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

async function startAdapter(): Promise<void> {
    console.error("[adapter-qq] Starting QQ adapter...");

    await tokenManager.start();
    console.error("[adapter-qq] Token manager started");

    const apiClient = new QqApiClient({
        tokenManager,
        apiBaseUrl: QQ_API_BASE_URL,
    });
    const replyWindow = new ReplyWindowTracker();

    const inboundClient = new QqInboundClient({
        serverUrl: QQ_ADAPTER_SERVER_WS_URL,
        channel: "qq",
        ...(CAICAI_WS_TOKEN === undefined ? {} : { token: CAICAI_WS_TOKEN }),
        onDisposition: (info) => {
            const reason = info.reason === undefined ? "" : ` reason=${errorText(info.reason)}`;
            console.error(`[adapter-qq] Inbound disposition ${info.disposition}${reason}`);
        },
        onOutboundReply: (reply) => {
            void handleOutboundReply(reply, apiClient, replyWindow).catch((error: unknown) => {
                console.error(`[adapter-qq] Outbound passive reply handler failed: ${errorText(error)}`);
            });
        },
    });
    inbound = inboundClient;
    inboundClient.start();

    // gateway 的 onDispatch 是同步签名，这里返回的 promise 无人 await，
    // 因此所有失败都必须在函数内部收敛为日志，不能逃逸成 unhandled rejection。
    const onDispatch = async (eventType: string, data: unknown): Promise<void> => {
        try {
            const normalized = normalizeQqEvent(eventType, data, { selfId, receivedAt: Date.now() });
            if (!normalized.ok) {
                // 不支持的事件类型属于正常情况：只记一条精简日志，不影响连接。
                console.error(
                    `[adapter-qq] Dispatch skipped eventType=${eventType} error=${errorText(normalized.error)}`,
                );
                return;
            }

            const scope = normalized.event.kind === "mention" ? "group" : normalized.event.kind === "dm" ? "c2c" : null;
            if (scope === null) {
                throw new Error(`unsupported normalized event kind: ${normalized.event.kind}`);
            }

            const messageId = normalized.event.platformMessageId;
            if (messageId === undefined) {
                throw new Error("normalized event is missing platformMessageId");
            }

            // 先登记被动回复窗口，再投递入站事件：核心可能立即请求回复。
            replyWindow.register(scope, messageId, normalized.event.occurredAt);
            await inboundClient.send(normalized.event);
        } catch (error) {
            console.error(`[adapter-qq] Dispatch warning eventType=${eventType} error=${errorText(error)}`);
        }
    };

    gateway = new QqGateway({
        tokenManager,
        apiBaseUrl: QQ_API_BASE_URL,
        intents: GROUP_AND_C2C_EVENT,
        onReady: (readySelfId) => {
            selfId = readySelfId;
            console.error(`[adapter-qq] QQ gateway connected selfId=${selfId}`);
        },
        onDispatch,
        onDisconnected: (reason, resumable) => {
            console.error(`[adapter-qq] QQ gateway disconnected resumable=${resumable} reason=${errorText(reason)}`);
        },
    });
    gateway.start();

    // stdout 已由 StdioServerTransport 占用，日志只能使用 console.error，不能破坏 MCP 帧。
    const mcpServer = createQqMcpServer({
        apiClient,
        replyWindow,
        selfId: () => selfId,
    });
    const transport = new StdioServerTransport();
    await startQqMcpServer(mcpServer, transport);
    console.error("[adapter-qq] MCP server started");
}

void startAdapter().catch((error: unknown) => {
    console.error(`[adapter-qq] Failed to start adapter: ${errorText(error)}`);
    shutdown(1);
});
