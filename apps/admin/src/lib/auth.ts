import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminConfig } from "./adminConfig";

export const ADMIN_TOKEN_COOKIE = "caicaiclaw_admin_token";

export function isAuthorized(request: Request | NextRequest): boolean {
    const token = readToken(request);
    return token !== undefined && tokensEqual(token, getAdminConfig().token);
}

export function unauthorizedResponse(): NextResponse {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function readToken(request: Request | NextRequest): string | undefined {
    const authorization = request.headers.get("authorization");
    if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
    const headerToken = request.headers.get("x-caicai-admin-token");
    if (headerToken) return headerToken;
    if (request instanceof NextRequest) return request.cookies.get(ADMIN_TOKEN_COOKIE)?.value;
    const cookieHeader = request.headers.get("cookie") ?? "";
    return cookieHeader
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${ADMIN_TOKEN_COOKIE}=`))
        ?.slice(ADMIN_TOKEN_COOKIE.length + 1);
}

export function setAuthCookie(response: NextResponse, token: string): void {
    response.cookies.set(ADMIN_TOKEN_COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });
}

function tokensEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
