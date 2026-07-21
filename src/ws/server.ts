import { WebSocket, WebSocketServer } from "ws";
import { AgentConfig, AgentRuntime, tools, toolsByName } from "../core/index.js";
import {
    errorToMessage,
    isValidClientId,
    parseClientMessage,
    runtimeOutputToServerMessages,
    serializeServerMessage,
    ServerMessage,
    WS_PROTOCOL_VERSION,
} from "./protocol.js";

import { homedir } from "node:os";
import { join } from 'node:path'

const MAX_STEP_LIMIT = 3;
const LOOP_WARNING_LENGTH = 1;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_SYSTEM_PROMPT_PATH = join(homedir(), '.caicaiclaw/SYSTEM.md')

const config: AgentConfig = {
    systemPromptPath: process.env.CAICAI_SYSTEM_PROMPT_PATH ?? DEFAULT_SYSTEM_PROMPT_PATH,
    maxStepLimit: MAX_STEP_LIMIT,
    loopWarningLength: LOOP_WARNING_LENGTH,
    tools,
    toolsByName,
};

type ClientConnection = {
    clientId: string;
    socket: WebSocket;
};

const clients = new Map<string, ClientConnection>();
let nextConnectionId = 1;
let nextClientId = 1;

const runtime = new AgentRuntime(config, {
    onOutput: async (event) => {
        for (const message of runtimeOutputToServerMessages(event)) {
            broadcast(message);
        }
    },
});

const host = process.env.CAICAI_WS_HOST ?? DEFAULT_HOST;
const port = Number.parseInt(process.env.CAICAI_WS_PORT ?? String(DEFAULT_PORT), 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CAICAI_WS_PORT must be an integer between 1 and 65535");
}

const runtimeTask = runtime.run();
runtimeTask.catch((error: unknown) => {
    const message = errorToMessage(error);
    console.error(`[runtime] stopped: ${message}`);
    broadcast({ type: "error", message });
});

const server = new WebSocketServer({ host, port });

server.on("connection", (socket, request) => {
    const connectionId = createConnectionId();
    const clientId = resolveClientId(request.url);
    clients.set(connectionId, { clientId, socket });

    send(socket, {
        type: "hello",
        protocolVersion: WS_PROTOCOL_VERSION,
        clientId,
    });

    socket.on("message", (data) => {
        const raw = data.toString("utf8");

        try {
            const message = parseClientMessage(raw);

            if (message.type === "ping") {
                send(socket, { type: "pong", requestId: message.requestId });
                return;
            }

            runtime.enqueue({
                text: message.text,
                source: makeSource(clientId, message.source),
                createdAt: Date.now(),
            });
            send(socket, { type: "ack", requestId: message.requestId });
        } catch (error) {
            send(socket, {
                type: "error",
                message: errorToMessage(error),
            });
        }
    });

    socket.on("close", () => {
        clients.delete(connectionId);
    });

    socket.on("error", (error) => {
        console.error(`[ws:${clientId}/${connectionId}] ${errorToMessage(error)}`);
    });

    console.log(`[ws:${clientId}/${connectionId}] connected`);
});

server.on("listening", () => {
    console.log(`CaiCaiClaw ws server listening on ws://${host}:${port}`);
});

server.on("error", (error) => {
    console.error(`[ws] ${errorToMessage(error)}`);
});

function createClientId(): string {
    const id = `client-${nextClientId}`;
    nextClientId += 1;
    return id;
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

    const url = new URL(rawUrl, "ws://localhost");
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
