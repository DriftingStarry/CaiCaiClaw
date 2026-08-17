import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireAuth } from "../../../../src/lib/api";
import { readToolResult } from "../../../../src/lib/logs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const turnId = request.nextUrl.searchParams.get("turnId") ?? "";
    const toolCallId = request.nextUrl.searchParams.get("toolCallId") ?? "";
    const offset = Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10);
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "4000", 10);
    if (!turnId || !toolCallId) return errorResponse("turnId and toolCallId are required");
    try {
        return NextResponse.json(await readToolResult(turnId, toolCallId, offset, limit));
    } catch (error) {
        return errorResponse(error, 400);
    }
}
