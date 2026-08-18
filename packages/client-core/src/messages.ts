import { ServerMessage } from "@caicaiclaw/protocol";
import { ClientState } from "./types";

export function applyInputAccepted(
    state: ClientState,
    message: Extract<ServerMessage, { type: "input_accepted" }>,
): ClientState {
    const existing = state.messages.find((item) => {
        if (item.role !== "user" || item.status !== "pending") return false;
        if (message.requestId) return item.id === message.requestId;
        // Keep text matching as a fallback for inputs from CLI and other sources without requestId.
        return item.text === message.event.text;
    });
    if (existing) {
        return {
            ...state,
            messages: state.messages.map((item) =>
                item.id === existing.id
                    ? { ...item, turnId: message.turnId, status: "done", createdAt: message.createdAt }
                    : item,
            ),
        };
    }

    return {
        ...state,
        messages: [
            ...state.messages,
            {
                id: `${message.turnId}:user`,
                role: "user",
                turnId: message.turnId,
                text: message.event.text,
                status: "done",
                createdAt: message.createdAt,
            },
        ],
    };
}

export function appendAssistantDelta(
    state: ClientState,
    turnId: string,
    text: string,
    receivedAt: number,
): ClientState {
    const id = `${turnId}:assistant`;
    const existing = state.messages.find((item) => item.id === id);

    if (!existing) {
        return {
            ...state,
            messages: [
                ...state.messages,
                {
                    id,
                    role: "assistant",
                    turnId,
                    text,
                    status: "streaming",
                    createdAt: receivedAt,
                },
            ],
        };
    }

    return {
        ...state,
        messages: state.messages.map((item) => (item.id === id ? { ...item, text: item.text + text } : item)),
    };
}
