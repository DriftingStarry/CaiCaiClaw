"use client";

const CLIENT_ID_STORAGE_KEY = "caicaiclaw.clientId";

export function getOrCreateClientId(): string {
    const storedClientId = getStoredClientId();
    if (storedClientId) return storedClientId;
    const clientId = `web-${crypto.randomUUID()}`;
    setStoredClientId(clientId);
    return clientId;
}

export function setStoredClientId(clientId: string): void {
    try {
        window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    } catch {
        return;
    }
}

function getStoredClientId(): string | undefined {
    try {
        const clientId = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY)?.trim();
        return clientId || undefined;
    } catch {
        return undefined;
    }
}
