import { WebSocket, WebSocketServer } from "ws";
import { errorMessage } from "@caicaiclaw/utils";
import { AgentConfig, AgentRuntime, tools, toolsByName } from "@caicaiclaw/agent-core";
import {
    isValidClientId,
    parseClientMessage,
    serializeServerMessage,
    ServerMessage,
    WS_PROTOCOL_VERSION,
} from "@caicaiclaw/protocol";
import { runtimeOutputToServerMessages } from "./runtimeOutputMapper.js";
import { loadServerConfig } from "./config.js";

import { randomUUID } from "node:crypto";

const serverConfig = loadServerConfig();

const config: AgentConfig = {
    systemPromptPath: serverConfig.systemPromptPath,
    maxStepLimit: serverConfig.maxStepLimit,
    loopWarningLength: serverConfig.loopWarningLength,
    tools,
    toolsByName,
};

type ClientConnection = {
    clientId: string;
    socket: WebSocket;
};

const clients = new Map<string, ClientConnection>();
let nextConnectionId = 1;

const runtime = new AgentRuntime(config, {
    rawHistoryPath: serverConfig.rawHistoryPath,
    onOutput: async (event) => {
        for (const message of runtimeOutputToServerMessages(event)) {
            broadcast(message);
        }
    },
});

const runtimeTask = runtime.run();
runtimeTask.catch((error: unknown) => {
    const message = errorMessage(error);
    console.error(`[runtime] stopped: ${message}`);
    broadcast({ type: "error", message });
});

const server = new WebSocketServer({ host: serverConfig.host, port: serverConfig.port });

server.on("connection", (socket, request) => {
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

            await runtime.enqueue({
                text: message.text,
                source: makeSource(clientId, message.source),
                createdAt: Date.now(),
            });
            send(socket, { type: "ack", requestId: message.requestId });
        } catch (error) {
            send(socket, {
                type: "error",
                message: errorMessage(error),
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

server.on("listening", () => {
    console.log(`CaiCaiClaw ws server listening on ws://${serverConfig.host}:${serverConfig.port}`);
});

server.on("error", (error) => {
    console.error(`[ws] ${errorMessage(error)}`);
});

function createClientId(): string {
    return `client-${randomUUID()}`;
}

function createConnectionId(): string {
    const id = `connection-${nextConnectionId}`;
    nextConnectionId += 1;
    return id;
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

function broadcast(message: ServerMessage): void {
    const payload = serializeServerMessage(message);
    for (const connection of clients.values()) {
        if (connection.socket.readyState === WebSocket.OPEN) {
            connection.socket.send(payload);
        }
    }
}

function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(serializeServerMessage(message));
    }
}
