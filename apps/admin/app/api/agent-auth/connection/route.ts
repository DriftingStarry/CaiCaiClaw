// admin token 原本只存在 httpOnly cookie 中，JS 无法读取；此处交给浏览器 JS，是因为 server 的 admin
// 角色握手要求 token 出现在 WS URL query 中，除此之外没有可用通路。这会扩大 XSS 影响面：拿到 token
// 即可冒充 admin 连接 WS，因此本路由必须始终受 requireAuth 保护，并且响应不得被缓存。
import { NextRequest, NextResponse } from "next/server";
import { getAdminConfig } from "../../../../src/lib/adminConfig";
import { getAgentWsToken } from "../../../../src/lib/agentAuth";
import { requireAuth } from "../../../../src/lib/api";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest): NextResponse {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const { token: adminToken } = getAdminConfig();
    const response = NextResponse.json({ token: getAgentWsToken(), adminToken });
    response.headers.set("Cache-Control", "no-store");
    return response;
}
