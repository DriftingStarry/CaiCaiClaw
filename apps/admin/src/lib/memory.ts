import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { getAdminConfig } from "./adminConfig";

export type MemoryVersion = {
    mtimeMs: number | null;
    hash: string;
};

export type MemoryDocument = {
    path: string;
    exists: boolean;
    content: string;
    version: MemoryVersion;
};

const EMPTY_HASH = hashContent("");

export async function listMemoryFiles(): Promise<string[]> {
    const root = await realMemoryDir();
    if (!root) return [];
    return walk(root, root);
}

export async function readMemoryFile(rawPath: string): Promise<MemoryDocument> {
    const target = await resolveMemoryPath(rawPath);
    try {
        const [content, stats] = await Promise.all([fs.readFile(target.path, "utf8"), fs.stat(target.path)]);
        return {
            path: target.relativePath,
            exists: true,
            content,
            version: { mtimeMs: stats.mtimeMs, hash: hashContent(content) },
        };
    } catch (error) {
        if (!isMissing(error)) throw error;
        return { path: target.relativePath, exists: false, content: "", version: { mtimeMs: null, hash: EMPTY_HASH } };
    }
}

export async function saveMemoryFile(
    rawPath: string,
    content: string,
    expectedVersion: MemoryVersion,
): Promise<MemoryDocument> {
    const target = await resolveMemoryPath(rawPath);
    const current = await readMemoryFile(target.relativePath);
    if (!sameVersion(current.version, expectedVersion)) {
        const conflict = new Error("memory file changed on disk; reload it before saving");
        Object.assign(conflict, { code: "MEMORY_CONFLICT" });
        throw conflict;
    }

    await fs.mkdir(dirname(target.path), { recursive: true });
    const temporaryPath = resolve(dirname(target.path), `.${target.path.split(sep).pop()}.${randomUUID()}.tmp`);
    try {
        await fs.writeFile(temporaryPath, content, "utf8");
        await fs.rename(temporaryPath, target.path);
    } finally {
        await fs.rm(temporaryPath, { force: true });
    }
    return readMemoryFile(target.relativePath);
}

async function resolveMemoryPath(rawPath: string): Promise<{ path: string; relativePath: string }> {
    const configuredRoot = resolve(getAdminConfig().memoryDir);
    const root = (await realpathOrMissing(configuredRoot)) ?? configuredRoot;
    if (typeof rawPath !== "string" || !rawPath.trim()) throw new Error("memory path is required");
    if (rawPath.includes("\0") || isAbsolute(rawPath) || /^[A-Za-z]:[\\/]/.test(rawPath)) {
        throw new Error("memory path must be relative to memoryDir");
    }
    if (extname(rawPath) !== ".md") throw new Error("only .md memory files are allowed");
    if (!isAllowedMemoryPath(rawPath))
        throw new Error("memory path must be SYSTEM.md, Role.md, Memory.md, or a tasks Markdown file");

    const candidate = resolve(configuredRoot, rawPath);
    const relativePath = relative(configuredRoot, candidate);
    if (
        !relativePath ||
        relativePath.startsWith(`..${sep}`) ||
        relativePath === ".." ||
        relativePath.includes(`${sep}..${sep}`)
    ) {
        throw new Error("memory path must remain inside memoryDir");
    }
    const existingRealPath = await realpathOrMissing(candidate);
    const parentRealPath = await realpathOrMissing(dirname(candidate));
    const checkedPath = existingRealPath ?? resolve(parentRealPath ?? root, candidate.split(sep).pop() ?? "");
    if (!isInside(root, checkedPath)) throw new Error("memory path resolves outside memoryDir");
    return { path: candidate, relativePath };
}

async function walk(directory: string, root: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            if (isInside(root, (await realpathOrMissing(fullPath)) ?? fullPath))
                files.push(...(await walk(fullPath, root)));
            continue;
        }
        if (!entry.isFile() || extname(entry.name) !== ".md") continue;
        const realPath = await realpathOrMissing(fullPath);
        const relativePath = relative(root, fullPath);
        if (realPath && isInside(root, realPath) && isAllowedMemoryPath(relativePath)) files.push(relativePath);
    }
    return files.sort();
}

async function realMemoryDir(): Promise<string | undefined> {
    const configuredRoot = resolve(getAdminConfig().memoryDir);
    return realpathOrMissing(configuredRoot);
}

async function realpathOrMissing(path: string): Promise<string | undefined> {
    try {
        return await fs.realpath(path);
    } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
    }
}

function isInside(root: string, candidate: string): boolean {
    const path = relative(root, candidate);
    return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
}

function isAllowedMemoryPath(path: string): boolean {
    const normalizedPath = path.split(sep).join("/");
    return (
        /^(?:SYSTEM|Role|Memory)\.md$/.test(normalizedPath) || /^tasks\/(?:archived\/)?[^/]+\.md$/.test(normalizedPath)
    );
}

function sameVersion(left: MemoryVersion, right: MemoryVersion): boolean {
    return left.mtimeMs === right.mtimeMs && left.hash === right.hash;
}

function hashContent(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

function isMissing(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
