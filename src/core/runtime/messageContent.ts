import { BaseMessage } from "@langchain/core/messages";

export function extractTextContent(content: unknown): string {
    if (typeof content === "string") return content;

    if (!Array.isArray(content)) return "";

    return content
        .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && "text" in item) {
                const text = (item as { text?: unknown }).text;
                return typeof text === "string" ? text : "";
            }
            return "";
        })
        .join("");
}

export function extractReasoningContent(message: BaseMessage): string {
    const additionalKwargs = getAdditionalKwargs(message);
    const reasoningContent = additionalKwargs.reasoning_content;
    if (typeof reasoningContent === "string" && reasoningContent.length > 0) {
        return reasoningContent;
    }

    const reasoningDetails = additionalKwargs.reasoning_details;
    if (!Array.isArray(reasoningDetails)) return "";

    return reasoningDetails
        .map((detail) => {
            if (!detail || typeof detail !== "object" || !("text" in detail)) return "";
            const text = (detail as { text?: unknown }).text;
            return typeof text === "string" ? text : "";
        })
        .filter((text) => text.length > 0)
        .join("");
}

function getAdditionalKwargs(message: BaseMessage): Record<string, unknown> {
    const direct = (message as { additional_kwargs?: unknown }).additional_kwargs;
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
        return direct as Record<string, unknown>;
    }

    const nested = (message as { lc_kwargs?: { additional_kwargs?: unknown } }).lc_kwargs?.additional_kwargs;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
    }

    return {};
}

