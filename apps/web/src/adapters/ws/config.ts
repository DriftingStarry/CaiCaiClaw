export const DEFAULT_WS_URL = "ws://127.0.0.1:8787";

export function getWsUrl(): string {
    return process.env.NEXT_PUBLIC_CAICAI_WS_URL ?? DEFAULT_WS_URL;
}

export function buildWsUrl(clientId?: string): string {
    const url = new URL(getWsUrl());

    if (clientId) {
        url.searchParams.set("clientId", clientId);
    }

    return url.toString();
}
