import { WebSocket, WebSocketServer } from "ws";
import { errorMessage } from "@caicaiclaw/utils";
import { AgentConfig, AgentRuntime, createOpenrouterModel, toolsByName } from "@caicaiclaw/agent-core";
import {
    isValidClientId,
    parseClientMessage,
    serializeServerMessage,
    ServerMessage,
    WS_PROTOCOL_VERSION,
} from "@caicaiclaw/protocol";
import { runtimeOutputToServerMessages } from "./runtimeOutputMapper";
import { loadServerConfig, type ServerConfig } from "./config";

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RunningServer = {
    close: () => Promise<void>;
};

type ClientConnection = {
    clientId: string;
    socket: WebSocket;
};

export function createServer(serverConfig: ServerConfig, model?: AgentConfig["model"]): RunningServer {
    const clients = new Map<string, ClientConnection>();
    let nextConnectionId = 1;
    let closing = false;
    let committedTurnCount = 0;
    let scheduledCompactInFlight = false;

    const config: AgentConfig = {
        maxStepLimit: serverConfig.maxStepLimit,
        loopWarningLength: serverConfig.loopWarningLength,
        model: model ?? createOpenrouterModel(serverConfig.openrouterModel),
        toolsByName,
    };

    function broadcast(message: ServerMessage): void {
        const payload = serializeServerMessage(message);
        for (const connection of clients.values()) {
            if (connection.socket.readyState === WebSocket.OPEN) {
                connection.socket.send(payload);
            }
        }
    }

    function createConnectionId(): string {
        const id = `connection-${nextConnectionId}`;
        nextConnectionId += 1;
        return id;
    }

    const runtime = new AgentRuntime(config, {
        rawHistoryPath: serverConfig.rawHistoryPath,
        systemPromptPath: serverConfig.systemPromptPath,
        memoryDir: serverConfig.memoryDir,
        // server 显式传入 memoryDir 后 runtime 默认会收紧缺失文件策略；保持服务端原有宽松行为。
        allowMissingMemoryFiles: true,
        compactionModelName: serverConfig.openrouterModel,
        onOutput: async (event) => {
            for (const message of runtimeOutputToServerMessages(event)) {
                broadcast(message);
            }
            if (event.type === "done") {
                scheduleCompactIfDue();
            }
        },
    });

    function scheduleCompactIfDue(): void {
        if (closing || serverConfig.compactEveryTurns === 0) return;
        committedTurnCount += 1;
        if (scheduledCompactInFlight || committedTurnCount % serverConfig.compactEveryTurns !== 0) return;

        scheduledCompactInFlight = true;
        void runtime
            .compact({ trigger: "scheduled" })
            .then((summary) => {
                broadcast({ type: "compact_result", summary, trigger: "scheduled" });
            })
            .catch((error: unknown) => {
                const message = safeErrorMessage(error);
                console.error(`[runtime] scheduled compact failed: ${message}`);
                broadcast({ type: "error", message });
            })
            .finally(() => {
                scheduledCompactInFlight = false;
            });
    }

    const runtimeTask = runtime.run();
    runtimeTask.catch((error: unknown) => {
        const message = errorMessage(error);
        console.error(`[runtime] stopped: ${message}`);
        broadcast({ type: "error", message });
        // runtime 已无法继续工作，交给进程级兜底关闭服务，避免留下僵尸进程。
        throw error;
    });

    const wss = new WebSocketServer({ host: serverConfig.host, port: serverConfig.port });

    wss.on("connection", (socket, request) => {
        const connectionId = createConnectionId();
        const clientId = resolveClientId(request.url);
        clients.set(connectionId, { clientId, socket });

        send(socket, {
            type: "hello",
            protocolVersion: WS_PROTOCOL_VERSION,
            clientId,
        });

        socket.on("message", async (data) => {
            const raw = data.toString("utf8");
            let requestId: string | undefined;

            try {
                const message = parseClientMessage(raw);
                requestId = message.requestId;

                if (message.type === "ping") {
                    send(socket, { type: "pong", requestId: message.requestId });
                    return;
                }

                if (message.type === "compact") {
                    const summary = await runtime.compact({ trigger: "manual" });
                    send(socket, {
                        type: "compact_result",
                        summary,
                        trigger: "manual",
                        requestId: message.requestId,
                    });
                    return;
                }

                if (message.type === "daydreaming") {
                    const summary = await runtime.daydreaming();
                    send(socket, {
                        type: "daydreaming_result",
                        summary,
                        requestId: message.requestId,
                    });
                    return;
                }

                await runtime.enqueue({
                    text: message.text,
                    source: makeSource(clientId, message.source),
                    createdAt: Date.now(),
                    requestId: message.requestId,
                });
                send(socket, { type: "ack", requestId: message.requestId });
            } catch (error) {
                send(socket, {
                    type: "error",
                    message: safeErrorMessage(error),
                    requestId,
                });
            }
        });

        socket.on("close", () => {
            clients.delete(connectionId);
        });

        socket.on("error", (error) => {
            console.error(`[ws:${clientId}/${connectionId}] ${errorMessage(error)}`);
        });

        console.log(`[ws:${clientId}/${connectionId}] connected`);
    });

    wss.on("listening", () => {
        console.log(`CaiCaiClaw ws server listening on ws://${serverConfig.host}:${serverConfig.port}`);
    });

    wss.on("error", (error) => {
        console.error(`[ws] ${errorMessage(error)}`);
    });

    return {
        close: async () => {
            closing = true;
            const serverClosed = new Promise<void>((resolve, reject) => {
                wss.close((error) => (error ? reject(error) : resolve()));
            });

            // ws 只会在存量连接关闭后完成 server close，先 await 会让关闭流程死锁。
            for (const connection of clients.values()) {
                if (connection.socket.readyState === WebSocket.OPEN) {
                    connection.socket.close();
                }
            }
            clients.clear();
            await serverClosed;

            runtime.stop();
            // rejection 已在 runtimeTask.catch 中处理，重复 await 时需要避免再次抛出。
            await runtimeTask.catch(() => {});
        },
    };
}

async function main(): Promise<void> {
    const serverConfig = loadServerConfig();
    const running = createServer(serverConfig);
    let shuttingDown = false;

    async function shutdown(signal: string): Promise<void> {
        // 信号可能连续到达，同一个关闭流程只能执行一次。
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;

        console.log(`[server] received ${signal}, shutting down`);
        try {
            await running.close();
            // 让事件循环自然排空，避免截断尚未 flush 的 JSONL 写入。
            process.exitCode = 0;
        } catch (error) {
            console.error(`[server] shutdown failed: ${errorMessage(error)}`);
            process.exitCode = 1;
        }
    }

    process.on("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
    process.on("uncaughtException", async (error) => {
        console.error(`[fatal] uncaughtException: ${errorMessage(error)}`);
        await shutdown("uncaughtException");
        process.exitCode = 1;
    });
    process.on("unhandledRejection", async (reason) => {
        console.error(`[fatal] unhandledRejection: ${errorMessage(reason)}`);
        await shutdown("unhandledRejection");
        process.exitCode = 1;
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(`[fatal] ${errorMessage(error)}`);
        process.exitCode = 1;
    });
}

function createClientId(): string {
    return `client-${randomUUID()}`;
}

function resolveClientId(rawUrl?: string): string {
    const clientId = getRequestedClientId(rawUrl);

    if (!clientId) {
        return createClientId();
    }

    if (isValidClientId(clientId)) {
        return clientId;
    }

    console.warn(`[ws] ignoring invalid clientId: ${JSON.stringify(clientId)}`);
    return createClientId();
}

function getRequestedClientId(rawUrl?: string): string | undefined {
    if (!rawUrl) {
        return undefined;
    }

    let url: URL;
    try {
        url = new URL(rawUrl, "ws://localhost");
    } catch {
        console.warn(`[ws] ignoring unparseable request URL: ${JSON.stringify(rawUrl)}`);
        return undefined;
    }

    const clientId = url.searchParams.get("clientId")?.trim();
    return clientId ? clientId : undefined;
}

function makeSource(clientId: string, source?: string): string {
    return source ? `ws:${clientId}/${source}` : `ws:${clientId}`;
}

function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(serializeServerMessage(message));
    }
}

function safeErrorMessage(error: unknown): string {
    const message = errorMessage(error)
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .replace(/\s+/g, " ")
        .trim();

    if (!message) return "unknown server error";
    return message.length > 2_000 ? `${message.slice(0, 2_000)}...` : message;
}
