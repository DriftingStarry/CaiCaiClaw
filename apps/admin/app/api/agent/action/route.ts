import { NextRequest, NextResponse } from "next/server";
import { requireAuth, errorResponse } from "../../../../src/lib/api";
import { safeErrorMessage } from "../../../../src/lib/error";
import { getSupervisor, type MaintenanceAction } from "../../../../src/lib/supervisor";

export const dynamic = "force-dynamic";

function isAgentStateConflict(message: string): boolean {
    return (
        message === "agent is already stopping" ||
        message.startsWith("cannot start agent while status is ") ||
        message.startsWith("cannot stop agent while status is ")
    );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const body: unknown = await request.json().catch(() => undefined);
    const action =
        typeof body === "object" && body !== null && "action" in body && typeof body.action === "string"
            ? body.action
            : undefined;
    if (!action || !["start", "stop", "restart", "compact", "daydreaming"].includes(action)) {
        return errorResponse("agent action must be start, stop, restart, compact, or daydreaming");
    }

    const supervisor = getSupervisor();
    try {
        if (action === "start") return NextResponse.json({ snapshot: supervisor.start() });
        if (action === "stop") return NextResponse.json({ snapshot: await supervisor.stop() });
        if (action === "restart") return NextResponse.json({ snapshot: await supervisor.restart() });
        const summary = await supervisor.sendMaintenance(action as MaintenanceAction);
        return NextResponse.json({ snapshot: supervisor.getSnapshot(), summary });
    } catch (error) {
        const message = safeErrorMessage(error);
        const status = isAgentStateConflict(message) ? 409 : 500;
        return errorResponse(message, status);
    }
}
