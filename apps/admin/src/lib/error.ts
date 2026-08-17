import { errorMessage } from "@caicaiclaw/utils";

export function safeErrorMessage(error: unknown): string {
    const message = errorMessage(error)
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .replace(/\s+/g, " ")
        .trim();

    if (!message) return "unknown admin error";
    return message.length > 2_000 ? `${message.slice(0, 2_000)}...` : message;
}
