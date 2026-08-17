import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireAuth } from "../../../../src/lib/api";
import { readMemoryFile, saveMemoryFile, type MemoryVersion } from "../../../../src/lib/memory";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    try {
        return NextResponse.json(await readMemoryFile((await context.params).path.join("/")));
    } catch (error) {
        return errorResponse(error, 400);
    }
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const body: unknown = await request.json().catch(() => undefined);
    if (!isSaveBody(body)) return errorResponse("memory save requires content and version { mtimeMs, hash }");
    try {
        const document = await saveMemoryFile((await context.params).path.join("/"), body.content, body.version);
        return NextResponse.json(document);
    } catch (error) {
        if (isConflict(error)) return errorResponse(error, 409);
        return errorResponse(error, 400);
    }
}

function isSaveBody(value: unknown): value is { content: string; version: MemoryVersion } {
    if (typeof value !== "object" || value === null || !("content" in value) || !("version" in value)) return false;
    const version = value.version;
    return (
        typeof value.content === "string" &&
        typeof version === "object" &&
        version !== null &&
        "mtimeMs" in version &&
        (version.mtimeMs === null || typeof version.mtimeMs === "number") &&
        "hash" in version &&
        typeof version.hash === "string"
    );
}

function isConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "MEMORY_CONFLICT";
}
