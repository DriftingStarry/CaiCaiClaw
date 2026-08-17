import { promises as fs } from "node:fs";
import { getAdminConfig } from "./adminConfig";

export type LogPage = {
    exists: boolean;
    groups: LogGroup[];
    errors: string[];
    offset: number;
    limit: number;
    hasMore: boolean;
};

export type LogGroup = {
    key: string;
    turnId?: string;
    kind: "turn" | "compaction" | "event";
    events: Array<{ lineNumber: number; event: Record<string, unknown> }>;
};

export type ToolResultPage = {
    turnId: string;
    toolCallId: string;
    offset: number;
    limit: number;
    totalLength: number;
    content: string;
    hasMore: boolean;
};

type LogLine = { lineNumber: number; text: string };

export async function readLogPage(offset: number, limit: number): Promise<LogPage> {
    validatePage(offset, limit);
    const path = getAdminConfig().rawHistoryPath;
    try {
        await fs.access(path);
    } catch (error) {
        if (isMissing(error)) return { exists: false, groups: [], errors: [], offset, limit, hasMore: false };
        throw error;
    }

    const groups: LogGroup[] = [];
    const errors: string[] = [];
    const inputToTurn = new Map<string, string>();
    let current: LogGroup | undefined;
    for await (const line of reverseLines(path)) {
        if (!line.text.trim()) continue;
        const parsed = parseLine(line);
        if (parsed.error) {
            errors.push(parsed.error);
            continue;
        }
        if (!parsed.event) continue;
        const event = parsed.event;
        if (event.type === "turn.started") {
            const turnId = stringValue(event.turnId);
            const inputIds = arrayOfStrings(event.inputIds);
            if (turnId) for (const inputId of inputIds) inputToTurn.set(inputId, turnId);
        }
        const identity = groupIdentity(event, inputToTurn);
        if (!current || current.key !== identity.key) {
            if (current) {
                groups.push(finalizeGroup(current));
                if (groups.length >= offset + limit) break;
            }
            current = { key: identity.key, turnId: identity.turnId, kind: identity.kind, events: [] };
        }
        current.events.push({ lineNumber: line.lineNumber, event: projectEvent(event) });
    }
    if (current && groups.length < offset + limit) groups.push(finalizeGroup(current));

    const pageGroups = groups.slice(offset, offset + limit);
    return {
        exists: true,
        groups: pageGroups,
        errors,
        offset,
        limit,
        hasMore:
            groups.length > offset + pageGroups.length ||
            (groups.length === offset + limit && pageGroups.length === limit),
    };
}

export async function readToolResult(
    turnId: string,
    toolCallId: string,
    offset: number,
    limit: number,
): Promise<ToolResultPage> {
    if (!Number.isInteger(offset) || offset < 0) throw new Error("tool result offset must be a non-negative integer");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100_000)
        throw new Error("tool result limit must be between 1 and 100000");

    const path = getAdminConfig().rawHistoryPath;
    try {
        await fs.access(path);
    } catch (error) {
        if (isMissing(error)) throw new Error("history.jsonl does not exist", { cause: error });
        throw error;
    }
    for await (const line of forwardLines(path)) {
        if (!line.text.trim()) continue;
        const parsed = parseLine(line);
        if (!parsed.event || parsed.event.type !== "tool.completed") continue;
        if (parsed.event.turnId !== turnId || parsed.event.toolCallId !== toolCallId) continue;
        const content = stringifyValue(parsed.event.result);
        if (offset > content.length)
            throw new Error(`tool result offset ${offset} is out of bounds for ${turnId}/${toolCallId}`);
        return {
            turnId,
            toolCallId,
            offset,
            limit,
            totalLength: content.length,
            content: content.slice(offset, offset + limit),
            hasMore: offset + limit < content.length,
        };
    }
    throw new Error(`tool result ${turnId}/${toolCallId} was not found`);
}

async function* reverseLines(path: string): AsyncGenerator<LogLine> {
    const handle = await fs.open(path, "r");
    try {
        const size = (await handle.stat()).size;
        let position = size;
        let lineNumber = await countPhysicalLines(path);
        let pending = Buffer.alloc(0);
        while (position > 0) {
            const length = Math.min(64 * 1024, position);
            position -= length;
            const chunk = Buffer.alloc(length);
            await handle.read(chunk, 0, length, position);
            pending = Buffer.concat([chunk, pending]);
            let newline = pending.lastIndexOf(10);
            while (newline >= 0) {
                if (newline === pending.length - 1) {
                    pending = pending.subarray(0, newline);
                    newline = pending.lastIndexOf(10);
                    continue;
                }
                yield {
                    lineNumber,
                    text: pending
                        .subarray(newline + 1)
                        .toString("utf8")
                        .replace(/\r$/, ""),
                };
                lineNumber -= 1;
                pending = pending.subarray(0, newline);
                newline = pending.lastIndexOf(10);
            }
        }
        if (pending.length > 0) yield { lineNumber, text: pending.toString("utf8").replace(/\r$/, "") };
    } finally {
        await handle.close();
    }
}

async function* forwardLines(path: string): AsyncGenerator<LogLine> {
    const handle = await fs.open(path, "r");
    try {
        let lineNumber = 0;
        let pending = Buffer.alloc(0);
        let position = 0;
        const size = (await handle.stat()).size;
        while (position < size) {
            const length = Math.min(64 * 1024, size - position);
            const chunk = Buffer.alloc(length);
            await handle.read(chunk, 0, length, position);
            position += length;
            pending = Buffer.concat([pending, chunk]);
            let newline = pending.indexOf(10);
            while (newline >= 0) {
                lineNumber += 1;
                yield { lineNumber, text: pending.subarray(0, newline).toString("utf8").replace(/\r$/, "") };
                pending = pending.subarray(newline + 1);
                newline = pending.indexOf(10);
            }
        }
        if (pending.length > 0) {
            lineNumber += 1;
            yield { lineNumber, text: pending.toString("utf8").replace(/\r$/, "") };
        }
    } finally {
        await handle.close();
    }
}

async function countPhysicalLines(path: string): Promise<number> {
    const handle = await fs.open(path, "r");
    try {
        let count = 0;
        let lastByte = -1;
        let position = 0;
        const size = (await handle.stat()).size;
        while (position < size) {
            const length = Math.min(64 * 1024, size - position);
            const chunk = Buffer.alloc(length);
            await handle.read(chunk, 0, length, position);
            position += length;
            count += chunk.reduce((total, byte) => total + (byte === 10 ? 1 : 0), 0);
            lastByte = chunk[chunk.length - 1] ?? lastByte;
        }
        return count + (size > 0 && lastByte !== 10 ? 1 : 0);
    } finally {
        await handle.close();
    }
}

function parseLine(line: LogLine): { event?: Record<string, unknown>; error?: string } {
    let value: unknown;
    try {
        value = JSON.parse(line.text);
    } catch {
        return { error: `history.jsonl line ${line.lineNumber} is not valid JSON` };
    }
    if (
        !isRecord(value) ||
        value.version !== 1 ||
        typeof value.type !== "string" ||
        !KNOWN_EVENT_TYPES.has(value.type) ||
        typeof value.sequence !== "number" ||
        !Number.isInteger(value.sequence) ||
        value.sequence < 1 ||
        typeof value.eventId !== "string" ||
        !value.eventId ||
        typeof value.createdAt !== "number"
    ) {
        return { error: `history.jsonl line ${line.lineNumber} has an invalid event schema` };
    }
    return { event: value };
}

const KNOWN_EVENT_TYPES = new Set([
    "input.accepted",
    "turn.started",
    "tool.started",
    "tool.completed",
    "turn.output_committed",
    "turn.failed",
    "context.compacted",
]);

function groupIdentity(
    event: Record<string, unknown>,
    inputToTurn: Map<string, string>,
): { key: string; kind: LogGroup["kind"]; turnId?: string } {
    if (event.type === "context.compacted")
        return { key: `compaction:${String(event.compactionId)}`, kind: "compaction" };
    const turnId =
        stringValue(event.turnId) ??
        (event.type === "input.accepted" ? inputToTurn.get(String(event.inputId)) : undefined);
    if (turnId) return { key: `turn:${turnId}`, kind: "turn", turnId };
    return { key: `event:${String(event.sequence)}`, kind: "event" };
}

function finalizeGroup(group: LogGroup): LogGroup {
    return { ...group, events: [...group.events].reverse() };
}

function projectEvent(event: Record<string, unknown>): Record<string, unknown> {
    if (event.type !== "tool.completed") return event;
    const result = stringifyValue(event.result);
    const previewLength = 500;
    return {
        ...event,
        result: undefined,
        resultLength: result.length,
        resultPreview: result.length > previewLength ? `${result.slice(0, previewLength)}...` : result,
    };
}

function stringifyValue(value: unknown): string {
    if (typeof value === "string") return value;
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePage(offset: number, limit: number): void {
    if (!Number.isInteger(offset) || offset < 0) throw new Error("log offset must be a non-negative integer");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("log limit must be between 1 and 50");
}

function isMissing(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
