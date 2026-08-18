import type { BaseMessage } from "@langchain/core/messages";
import type { ChannelEvent } from "@caicaiclaw/utils/history";

export {
    HISTORY_EVENT_TYPES,
    HISTORY_VERSION,
    channelEventSchema,
    parseHistoryLine,
    rawHistoryEventSchema,
    storedMessageSchema,
} from "@caicaiclaw/utils/history";
export type {
    ChannelEvent,
    HistoryEventType,
    HistoryLineParseResult,
    RawHistoryEvent,
    RawHistoryEventDraft,
    StoredMessagePayload,
} from "@caicaiclaw/utils/history";

export type RawHistoryInput = {
    inputId: string;
    event: ChannelEvent;
    requestId?: string;
    createdAt: number;
    message: BaseMessage;
};
