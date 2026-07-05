"use client";

const CLIENT_ID_STORAGE_KEY = "caicaiclaw.clientId";

export function getOrCreateClientId(): string {
    const storedClientId = getStoredClientId();
    if (storedClientId) {
        return storedClientId;
    }

    const clientId = `web-${crypto.randomUUID()}`;
    setStoredClientId(clientId);
    return clientId;
}

export function setStoredClientId(clientId: string): void {
    try {
        window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    } catch {
        // Ignore storage failures and fall back to in-memory connection identity.
    }
}

function getStoredClientId(): string | undefined {
    try {
        const clientId = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY)?.trim();
        return clientId ? clientId : undefined;
    } catch {
        return undefined;
    }
}
