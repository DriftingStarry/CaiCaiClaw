import { WebSocket, WebSocketServer } from "ws";
import { errorMessage } from "@caicaiclaw/utils";
import { AgentConfig, AgentRuntime, createOpenrouterModel, toolsByName } from "@caicaiclaw/agent-core";
import {
    isValidClientId,
    parseClientMessage,
    serializeServerMessage,
    ServerMessage,
    WS_PROTOCOL_VERSION,
    type ConnectionRole,
    type ClientRoleMessage,
} from "@caicaiclaw/protocol";
import { runtimeOutputToServerMessages } from "./runtimeOutputMapper";
import { loadServerConfig, type ServerConfig } from "./config";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RunningServer = {
    close: () => Promise<void>;
};

type ClientConnection = {
    clientId: string;
    socket: WebSocket;
    role?: ConnectionRole;
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

    function sendToObservers(message: ServerMessage): void {
        const payload = serializeServerMessage(message);
        for (const connection of clients.values()) {
            if (connection.role?.role === "observer") sendPayload(connection.socket, payload);
        }
    }

    function sendRuntimeOutput(message: ServerMessage): void {
        const payload = serializeServerMessage(message);
        for (const connection of clients.values()) {
            if (connection.role?.role === "observer") {
                sendPayload(connection.socket, payload);
                continue;
            }

            if (
                connection.role?.role === "adapter" &&
                "target" in message &&
                message.target?.channel === connection.role.channel
            ) {
                sendPayload(connection.socket, payload);
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
                sendRuntimeOutput(message);
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
                sendToObservers({ type: "compact_result", summary, trigger: "scheduled" });
            })
            .catch((error: unknown) => {
                const message = safeErrorMessage(error);
                console.error(`[runtime] scheduled compact failed: ${message}`);
                sendToObservers({ type: "error", message });
            })
            .finally(() => {
                scheduledCompactInFlight = false;
            });
    }

    const runtimeTask = runtime.run();
    runtimeTask.catch((error: unknown) => {
        const message = safeErrorMessage(error);
        console.error(`[runtime] stopped: ${message}`);
        sendToObservers({ type: "error", message });
        // runtime 已无法继续工作，交给进程级兜底关闭服务，避免留下僵尸进程。
        throw error;
    });

    const wss = new WebSocketServer({
        host: serverConfig.host,
        port: serverConfig.port,
        verifyClient: ({ req }, callback) => {
            if (!serverConfig.wsToken) {
                callback(true);
                return;
            }
            const token = getRequestToken(req.url);
            callback(tokensEqual(token, serverConfig.wsToken), 401, "Unauthorized");
        },
    });

    wss.on("connection", (socket, request) => {
        const connectionId = createConnectionId();
        const clientId = resolveClientId(request.url);
        const connection: ClientConnection = { clientId, socket };
        clients.set(connectionId, connection);

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
                requestId = "requestId" in message ? message.requestId : undefined;

                if (message.type === "role") {
                    if (connection.role) throw new Error("connection role has already been declared");
                    connection.role = toConnectionRole(message);
                    return;
                }

                if (!connection.role) {
                    throw new Error("connection role must be declared before other messages");
                }

                if (
                    connection.role.role === "adapter" &&
                    message.type === "input" &&
                    message.event.channel !== connection.role.channel
                ) {
                    throw new Error("adapter input channel must match the declared connection channel");
                }

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

                const receivedAt = Date.now();
                const admission = await runtime.enqueue({
                    ...message.event,
                    author: { ...message.event.author, isSelf: false },
                    receivedAt,
                    requestId: message.requestId,
                });
                send(socket, {
                    type: "ack",
                    requestId: message.requestId,
                    disposition: admission.disposition,
                    ...(admission.disposition === "dropped" ? { reason: admission.reason } : {}),
                    ...(admission.disposition === "merged" || admission.disposition === "accepted"
                        ? admission.batchId
                            ? { batchId: admission.batchId }
                            : {}
                        : {}),
                });
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

function getRequestToken(requestUrl: string | undefined): string | undefined {
    if (!requestUrl) return undefined;
    try {
        return new URL(requestUrl, "ws://localhost").searchParams.get("token") ?? undefined;
    } catch {
        return undefined;
    }
}

function tokensEqual(left: string | undefined, right: string): boolean {
    if (!left) return false;
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
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

function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(serializeServerMessage(message));
    }
}

function sendPayload(socket: WebSocket, payload: string): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
}

function toConnectionRole(message: ClientRoleMessage): ConnectionRole {
    if (message.role === "observer") return { role: "observer" };
    return { role: "adapter", channel: message.channel };
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
