import {
    BaseMessage,
    mapChatMessagesToStoredMessages,
    mapStoredMessagesToChatMessages,
    StoredMessage,
} from "@langchain/core/messages";
import { errorMessage } from "@caicaiclaw/utils";
import { storedMessageSchema, StoredMessagePayload } from "./historyEvents.js";

export function serializeHistoryMessages(messages: BaseMessage[]): StoredMessagePayload[] {
    return mapChatMessagesToStoredMessages(messages).map(sanitizeStoredMessage);
}

/** Serializes one message for persistence, applying the same sanitizing as a batch. */
export function serializeHistoryMessage(message: BaseMessage): StoredMessagePayload {
    const [stored] = serializeHistoryMessages([message]);
    if (!stored) throw new Error("message could not be serialized");
    return stored;
}

export function restoreStoredMessages(messages: StoredMessagePayload[]): BaseMessage[] {
    try {
        return mapStoredMessagesToChatMessages(messages.map(sanitizeStoredMessage).map(toLangChainStoredMessage));
    } catch (error) {
        throw new Error(`invalid stored message: ${errorMessage(error)}`, { cause: error });
    }
}

/**
 * The single adapter between our validated payload and LangChain's `StoredMessage`.
 * `StoredMessageData` declares `content: string` and no index signature, but LangChain
 * itself writes array content and extra keys, so the declared type is narrower than the
 * real wire format. The cast is confined here; `sanitizeStoredMessage` has already
 * validated `type`/`data` before this point.
 */
function toLangChainStoredMessage(message: StoredMessagePayload): StoredMessage {
    return message as StoredMessage;
}

function sanitizeStoredMessage(message: StoredMessage | StoredMessagePayload): StoredMessagePayload {
    const data: Record<string, unknown> = { ...message.data };
    const additionalKwargs = data.additional_kwargs;

    if (isRecord(additionalKwargs)) {
        const sanitizedAdditionalKwargs = { ...additionalKwargs };
        delete sanitizedAdditionalKwargs.reasoning_content;
        delete sanitizedAdditionalKwargs.reasoning_details;
        data.additional_kwargs = sanitizedAdditionalKwargs;
    }

    if (Array.isArray(data.content)) {
        data.content = data.content.filter((block) => !isRecord(block) || block.type !== "reasoning");
    }

    return storedMessageSchema.parse({ type: message.type, data });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
