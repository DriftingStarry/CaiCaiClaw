export const DEFAULT_WS_URL = "ws://127.0.0.1:8787";

export function getWsUrl(): string {
    return process.env.NEXT_PUBLIC_CAICAI_WS_URL ?? DEFAULT_WS_URL;
}
