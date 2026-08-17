import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { getAdminConfig } from "./adminConfig";

const MAX_TOKEN_LENGTH = 512;

export function getAgentWsToken(): string {
    const { agentToken, agentTokenPath } = getAdminConfig();
    if (!existsSync(agentTokenPath)) return agentToken;
    return validateToken(readFileSync(agentTokenPath, "utf8"), true);
}

export function hasAgentWsToken(): boolean {
    return Boolean(getAgentWsToken());
}

export function updateAgentWsToken(token: string): void {
    const value = validateToken(token, false);
    const path = getAdminConfig().agentTokenPath;
    if (!value) {
        rmSync(path, { force: true });
        return;
    }

    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = resolve(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    try {
        writeFileSync(temporaryPath, value, { encoding: "utf8", mode: 0o600 });
        renameSync(temporaryPath, path);
    } finally {
        rmSync(temporaryPath, { force: true });
    }
}

function validateToken(value: string, fromStorage: boolean): string {
    if (value.length > MAX_TOKEN_LENGTH) throw new Error("agent WebSocket token must be at most 512 characters");
    if (/\r|\n|\0/.test(value)) throw new Error("agent WebSocket token must not contain control characters");
    if (!fromStorage && value !== value.trim())
        throw new Error("agent WebSocket token must not start or end with whitespace");
    return value;
}
