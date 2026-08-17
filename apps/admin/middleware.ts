import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest): NextResponse {
    if (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/api/auth") {
        return NextResponse.next();
    }

    const queryToken = request.nextUrl.searchParams.get("token");
    if (queryToken && isToken(queryToken)) {
        const cleanUrl = request.nextUrl.clone();
        cleanUrl.searchParams.delete("token");
        const response = NextResponse.redirect(cleanUrl);
        response.cookies.set("caicaiclaw_admin_token", queryToken, {
            httpOnly: true,
            sameSite: "strict",
            secure: process.env.NODE_ENV === "production",
            path: "/",
        });
        return response;
    }

    if (request.cookies.get("caicaiclaw_admin_token")?.value === process.env.CAICAI_ADMIN_TOKEN)
        return NextResponse.next();
    if (request.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
}

function isToken(value: string): boolean {
    return Boolean(process.env.CAICAI_ADMIN_TOKEN) && value === process.env.CAICAI_ADMIN_TOKEN;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
