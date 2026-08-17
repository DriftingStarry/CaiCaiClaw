import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireAuth } from "../../../src/lib/api";
import { listMemoryFiles } from "../../../src/lib/memory";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    try {
        return NextResponse.json({ files: await listMemoryFiles() });
    } catch (error) {
        return errorResponse(error, 500);
    }
}
