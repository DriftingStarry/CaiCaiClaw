import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireAuth } from "../../../src/lib/api";
import { readLogPage } from "../../../src/lib/logs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const offset = Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10);
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "10", 10);
    try {
        return NextResponse.json(await readLogPage(offset, limit));
    } catch (error) {
        return errorResponse(error, 400);
    }
}
