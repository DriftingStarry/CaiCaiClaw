import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ServerConfig = {
    host: string;
    port: number;
    openrouterModel: string;
    systemPromptPath: string;
    rawHistoryPath: string;
    memoryDir: string;
    compactEveryTurns: number;
    maxStepLimit: number;
    loopWarningLength: number;
    wsToken: string;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_SYSTEM_PROMPT_PATH = join(homedir(), ".caicaiclaw/SYSTEM.md");
const DEFAULT_RAW_HISTORY_PATH = join(homedir(), ".caicaiclaw/history.jsonl");
const DEFAULT_MAX_STEP_LIMIT = 3;
const DEFAULT_LOOP_WARNING_LENGTH = 1;

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
    const openrouterModel = env.OPENROUTER_MODEL;
    // 模型名在配置边界校验，避免库包隐式依赖进程环境。
    if (!openrouterModel) {
        throw new Error("OPENROUTER_MODEL must be set");
    }

    const systemPromptPath = env.CAICAI_SYSTEM_PROMPT_PATH ?? DEFAULT_SYSTEM_PROMPT_PATH;
    const rawHistoryPath = env.CAICAI_RAW_HISTORY_PATH ?? DEFAULT_RAW_HISTORY_PATH;

    return {
        host: env.CAICAI_WS_HOST ?? DEFAULT_HOST,
        port: parseInteger(
            env.CAICAI_WS_PORT,
            DEFAULT_PORT,
            (value) => value >= 1 && value <= 65_535,
            "CAICAI_WS_PORT must be an integer between 1 and 65535",
        ),
        openrouterModel,
        // 必须用 ?? 而不是 ||：空串是有意义的取值，表示不加载 system prompt。
        systemPromptPath,
        rawHistoryPath,
        // 默认值复刻 AgentRuntime 的 dirname(systemPromptPath || rawHistoryPath) 推导。
        memoryDir: env.CAICAI_MEMORY_DIR ?? dirname(systemPromptPath || rawHistoryPath),
        compactEveryTurns: parseInteger(
            env.CAICAI_COMPACT_EVERY_TURNS,
            0,
            (value) => value >= 0,
            "CAICAI_COMPACT_EVERY_TURNS must be an integer >= 0",
        ),
        maxStepLimit: parseInteger(
            env.CAICAI_MAX_STEP_LIMIT,
            DEFAULT_MAX_STEP_LIMIT,
            (value) => value >= 1,
            "CAICAI_MAX_STEP_LIMIT must be an integer >= 1",
        ),
        loopWarningLength: parseInteger(
            env.CAICAI_LOOP_WARNING_LENGTH,
            DEFAULT_LOOP_WARNING_LENGTH,
            (value) => value >= 1,
            "CAICAI_LOOP_WARNING_LENGTH must be an integer >= 1",
        ),
        wsToken: env.CAICAI_WS_TOKEN ?? "",
    };
}

function parseInteger(
    value: string | undefined,
    defaultValue: number,
    isValid: (parsedValue: number) => boolean,
    errorMessage: string,
): number {
    const parsedValue = Number.parseInt(value ?? String(defaultValue), 10);
    if (!Number.isInteger(parsedValue) || !isValid(parsedValue)) {
        throw new Error(errorMessage);
    }

    return parsedValue;
}
