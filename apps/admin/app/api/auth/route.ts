import { NextRequest, NextResponse } from "next/server";
import { getAdminConfig } from "../../../src/lib/adminConfig";
import { isAuthorized, setAuthCookie } from "../../../src/lib/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
    const body: unknown = await request.json().catch(() => undefined);
    const token =
        typeof body === "object" && body !== null && "token" in body && typeof body.token === "string"
            ? body.token
            : undefined;
    const tokenRequest = new Request(request.url, { headers: { authorization: token ? `Bearer ${token}` : "" } });
    if (!token || !isAuthorized(tokenRequest)) return NextResponse.json({ error: "invalid token" }, { status: 401 });

    const response = NextResponse.json({ ok: true });
    setAuthCookie(response, getAdminConfig().token);
    return response;
}
