import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorizedResponse } from "./auth";
import { safeErrorMessage } from "./error";

export function requireAuth(request: NextRequest): NextResponse | undefined {
    return isAuthorized(request) ? undefined : unauthorizedResponse();
}

export function errorResponse(error: unknown, status = 400): NextResponse {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status });
}
