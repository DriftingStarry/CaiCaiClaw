import { ConnectionStatus } from "@caicaiclaw/client-core";

export function connectionLabel(status: ConnectionStatus): string {
    if (status === "connected") return "connected";
    if (status === "connecting") return "connecting…";
    if (status === "reconnecting") return "reconnecting…";
    if (status === "closed") return "offline";
    return "idle";
}

export function connectionColor(status: ConnectionStatus): "green" | "yellow" | "red" | "gray" {
    if (status === "connected") return "green";
    if (status === "connecting" || status === "reconnecting") return "yellow";
    if (status === "closed") return "red";
    return "gray";
}
