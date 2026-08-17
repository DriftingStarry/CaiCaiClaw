import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAdminConfig } from "./adminConfig";

export const ADMIN_TOKEN_COOKIE = "caicaiclaw_admin_token";

/**
 * 凭据只从 httpOnly cookie 读取。middleware 用同一个 cookie 拦下所有未认证请求，
 * 路由层这次校验是纵深防御；两侧必须看同一个来源，否则会出现 middleware 拒绝而
 * 路由放行的分歧路径。
 */
export function isAuthorized(request: NextRequest): boolean {
    const token = request.cookies.get(ADMIN_TOKEN_COOKIE)?.value;
    return token !== undefined && verifyToken(token);
}

export function verifyToken(token: string): boolean {
    return tokensEqual(token, getAdminConfig().token);
}

export function unauthorizedResponse(): NextResponse {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
