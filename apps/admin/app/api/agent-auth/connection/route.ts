import { NextRequest, NextResponse } from "next/server";
import { getAgentWsToken } from "../../../../src/lib/agentAuth";
import { requireAuth } from "../../../../src/lib/api";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest): NextResponse {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const response = NextResponse.json({ token: getAgentWsToken() });
    response.headers.set("Cache-Control", "no-store");
    return response;
}
