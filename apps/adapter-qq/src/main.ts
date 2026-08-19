/**
 * QQ 开放平台 adapter 入口
 *
 * 本进程持有 QQ 机器人的 AppID/AppSecret 与平台长连接，同时提供：
 * - 出站面：MCP server（工具调用）
 * - 入站面：WS client（向 apps/server 投递 ChannelEvent）
 */

console.log("QQ adapter starting...");

// Placeholder for now
process.on("SIGINT", () => {
    console.log("QQ adapter shutting down...");
    process.exit(0);
});
