/**
 * QQ 开放平台 adapter 入口
 *
 * 本进程持有 QQ 机器人的 AppID/AppSecret 与平台长连接，同时提供：
 * - 出站面：MCP server（工具调用）
 * - 入站面：WS client（向 apps/server 投递 ChannelEvent）
 */

import { TokenManager } from "./token-manager";

const QQ_BOT_APP_ID = process.env.QQ_BOT_APP_ID;
const QQ_BOT_CLIENT_SECRET = process.env.QQ_BOT_CLIENT_SECRET;
const QQ_API_BASE_URL = process.env.QQ_API_BASE_URL || "https://api.bot.qq.com";

if (!QQ_BOT_APP_ID || !QQ_BOT_CLIENT_SECRET) {
    console.error("[adapter-qq] Missing required env: QQ_BOT_APP_ID or QQ_BOT_CLIENT_SECRET");
    process.exit(1);
}

console.log("[adapter-qq] Starting QQ adapter...");

const tokenManager = new TokenManager({
    appId: QQ_BOT_APP_ID,
    clientSecret: QQ_BOT_CLIENT_SECRET,
    apiBaseUrl: QQ_API_BASE_URL,
});

// 启动 token 管理
tokenManager
    .start()
    .then(() => {
        console.log("[adapter-qq] Token manager started");
    })
    .catch((err) => {
        console.error("[adapter-qq] Failed to start token manager:", err);
        process.exit(1);
    });

process.on("SIGINT", () => {
    console.log("[adapter-qq] Shutting down...");
    tokenManager.stop();
    process.exit(0);
});

process.on("SIGTERM", () => {
    console.log("[adapter-qq] Shutting down...");
    tokenManager.stop();
    process.exit(0);
});
