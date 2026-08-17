import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../src/lib/api";
import { getSupervisor } from "../../../src/lib/supervisor";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest): NextResponse {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    return NextResponse.json(getSupervisor().getSnapshot());
}
