import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export type AdminConfig = {
    token: string;
    host: "127.0.0.1";
    port: number;
    agentHost: "127.0.0.1";
    agentPort: number;
    agentToken: string;
    agentTokenPath: string;
    rawHistoryPath: string;
    memoryDir: string;
    stopGraceMs: number;
    startupTimeoutMs: number;
};

const DEFAULT_RAW_HISTORY_PATH = join(homedir(), ".caicaiclaw/history.jsonl");
const DEFAULT_SYSTEM_PROMPT_PATH = join(homedir(), ".caicaiclaw/SYSTEM.md");

let cachedConfig: AdminConfig | undefined;

export function loadAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
    const token = env.CAICAI_ADMIN_TOKEN;
    if (!token) {
        throw new Error("CAICAI_ADMIN_TOKEN must be set; refusing to start an unauthenticated admin");
    }

    const rawHistoryPath = resolve(env.CAICAI_RAW_HISTORY_PATH ?? DEFAULT_RAW_HISTORY_PATH);
    const systemPromptPath = env.CAICAI_SYSTEM_PROMPT_PATH ?? DEFAULT_SYSTEM_PROMPT_PATH;

    return {
        token,
        host: "127.0.0.1",
        port: parseInteger(
            env.CAICAI_ADMIN_PORT,
            3001,
            (value) => value >= 1 && value <= 65_535,
            "CAICAI_ADMIN_PORT must be an integer between 1 and 65535",
        ),
        agentHost: "127.0.0.1",
        agentPort: parseInteger(
            env.CAICAI_WS_PORT,
            8787,
            (value) => value >= 1 && value <= 65_535,
            "CAICAI_WS_PORT must be an integer between 1 and 65535",
        ),
        agentToken: env.CAICAI_WS_TOKEN ?? "",
        agentTokenPath: resolve(env.CAICAI_WS_TOKEN_PATH ?? join(dirname(rawHistoryPath), "agent-ws-token")),
        rawHistoryPath,
        memoryDir: resolve(env.CAICAI_MEMORY_DIR ?? dirname(systemPromptPath || rawHistoryPath)),
        stopGraceMs: parseInteger(
            env.CAICAI_ADMIN_STOP_GRACE_MS,
            10_000,
            (value) => value >= 1,
            "CAICAI_ADMIN_STOP_GRACE_MS must be an integer >= 1",
        ),
        startupTimeoutMs: parseInteger(
            env.CAICAI_ADMIN_STARTUP_TIMEOUT_MS,
            15_000,
            (value) => value >= 1,
            "CAICAI_ADMIN_STARTUP_TIMEOUT_MS must be an integer >= 1",
        ),
    };
}

export function getAdminConfig(): AdminConfig {
    cachedConfig ??= loadAdminConfig();
    return cachedConfig;
}

function parseInteger(
    value: string | undefined,
    defaultValue: number,
    isValid: (parsedValue: number) => boolean,
    message: string,
): number {
    const parsed = Number.parseInt(value ?? String(defaultValue), 10);
    if (!Number.isInteger(parsed) || !isValid(parsed)) throw new Error(message);
    return parsed;
}
