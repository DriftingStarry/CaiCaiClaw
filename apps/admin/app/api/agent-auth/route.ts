import { NextRequest, NextResponse } from "next/server";
import { hasAgentWsToken, updateAgentWsToken } from "../../../src/lib/agentAuth";
import { errorResponse, requireAuth } from "../../../src/lib/api";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest): NextResponse {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const response = NextResponse.json({ configured: hasAgentWsToken() });
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const body: unknown = await request.json().catch(() => undefined);
    if (!isUpdateBody(body)) return errorResponse("agent WebSocket token must be a string");
    try {
        updateAgentWsToken(body.token);
        const response = NextResponse.json({ configured: hasAgentWsToken() });
        response.headers.set("Cache-Control", "no-store");
        return response;
    } catch (error) {
        return errorResponse(error);
    }
}

function isUpdateBody(value: unknown): value is { token: string } {
    return typeof value === "object" && value !== null && "token" in value && typeof value.token === "string";
}
