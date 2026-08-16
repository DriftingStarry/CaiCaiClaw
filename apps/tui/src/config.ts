export const DEFAULT_TUI_WS_URL = "ws://127.0.0.1:8787";

export function getTuiWsUrl(): string {
    return process.env.CAICAI_TUI_WS_URL ?? DEFAULT_TUI_WS_URL;
}
