import { z } from "zod";

import type { ChannelEvent } from "@caicaiclaw/utils/history";
import { channelEventSchema } from "@caicaiclaw/utils/history";

export const QQ_CHANNEL = "qq";

const GROUP_AT_MESSAGE_CREATE = "GROUP_AT_MESSAGE_CREATE";
const C2C_MESSAGE_CREATE = "C2C_MESSAGE_CREATE";

/**
 * 平台 User 结构：群聊场景身份在 member_openid，单聊在 user_openid，`id` 并非必然下发。
 * 因此这里三个字段都是可选，由各事件分支按场景取到具体 openid 后再校验非空。
 */
const authorSchema = z.looseObject({
    id: z.string().min(1).optional(),
    member_openid: z.string().min(1).optional(),
    member_role: z.string().min(1).optional(),
    user_openid: z.string().min(1).optional(),
    username: z.string().optional(),
    bot: z.boolean().optional(),
});

const groupMessageSchema = z.looseObject({
    id: z.string().min(1),
    author: authorSchema,
    content: z.string().optional(),
    group_openid: z.string().min(1),
    timestamp: z.string(),
});

const c2cMessageSchema = z.looseObject({
    id: z.string().min(1),
    author: authorSchema,
    content: z.string().optional(),
    timestamp: z.string(),
});

export type QqNormalizeContext = {
    selfId: string | null;
    receivedAt?: number;
};

export type NormalizeResult = { ok: true; event: ChannelEvent } | { ok: false; error: string };

export function qqConversationId(scope: "group" | "c2c", openid: string): string {
    return `qq:${scope}/${openid}`;
}

export function normalizeQqEvent(eventType: string, data: unknown, ctx: QqNormalizeContext): NormalizeResult {
    const receivedAt = normalizeTimestamp(ctx.receivedAt ?? Date.now());
    if (receivedAt === null) {
        return { ok: false, error: "receivedAt must be a finite non-negative number" };
    }

    if (eventType === GROUP_AT_MESSAGE_CREATE) {
        const parsed = groupMessageSchema.safeParse(data);
        if (!parsed.success) {
            return { ok: false, error: `invalid ${eventType} payload: ${z.prettifyError(parsed.error)}` };
        }

        const authorId = parsed.data.author.member_openid ?? parsed.data.author.id;
        if (authorId === undefined) {
            return { ok: false, error: `invalid ${eventType} payload: author has neither member_openid nor id` };
        }
        return buildChannelEvent(
            {
                channel: QQ_CHANNEL,
                conversationId: qqConversationId("group", parsed.data.group_openid),
                platformMessageId: parsed.data.id,
                kind: "mention",
                text: parsed.data.content ?? "",
                author: buildAuthor(parsed.data.author, authorId, ctx.selfId, parsed.data.author.member_role),
                payload: parsed.data as NonNullable<ChannelEvent["payload"]>,
                occurredAt: parseOccurredAt(parsed.data.timestamp, receivedAt),
                receivedAt,
                replyTo: parsed.data.id,
            },
            eventType,
        );
    }

    if (eventType === C2C_MESSAGE_CREATE) {
        const parsed = c2cMessageSchema.safeParse(data);
        if (!parsed.success) {
            return { ok: false, error: `invalid ${eventType} payload: ${z.prettifyError(parsed.error)}` };
        }

        const authorId = parsed.data.author.user_openid ?? parsed.data.author.id;
        if (authorId === undefined) {
            return { ok: false, error: `invalid ${eventType} payload: author has neither user_openid nor id` };
        }
        return buildChannelEvent(
            {
                channel: QQ_CHANNEL,
                conversationId: qqConversationId("c2c", authorId),
                platformMessageId: parsed.data.id,
                kind: "dm",
                text: parsed.data.content ?? "",
                author: buildAuthor(parsed.data.author, authorId, ctx.selfId),
                payload: parsed.data as NonNullable<ChannelEvent["payload"]>,
                occurredAt: parseOccurredAt(parsed.data.timestamp, receivedAt),
                receivedAt,
                replyTo: parsed.data.id,
            },
            eventType,
        );
    }

    return { ok: false, error: `unsupported QQ event type: ${eventType}` };
}

function buildAuthor(
    author: z.infer<typeof authorSchema>,
    authorId: string,
    selfId: string | null,
    role?: string,
): ChannelEvent["author"] {
    const normalizedAuthor: ChannelEvent["author"] = {
        id: authorId,
        isSelf: author.bot === true || (selfId !== null && selfId === authorId),
    };

    if (author.username !== undefined) {
        normalizedAuthor.displayName = author.username;
    }

    if (role !== undefined) {
        normalizedAuthor.role = role;
    }

    return normalizedAuthor;
}

function buildChannelEvent(event: ChannelEvent, eventType: string): NormalizeResult {
    const parsed = channelEventSchema.safeParse(event);
    if (!parsed.success) {
        return {
            ok: false,
            error: `normalized ${eventType} event violates ChannelEvent schema: ${z.prettifyError(parsed.error)}`,
        };
    }

    return { ok: true, event: parsed.data };
}

function parseOccurredAt(timestamp: string | undefined, receivedAt: number): number {
    if (timestamp === undefined) {
        return receivedAt;
    }

    const parsedTimestamp = Date.parse(timestamp);
    return Number.isFinite(parsedTimestamp) && parsedTimestamp >= 0 ? Math.trunc(parsedTimestamp) : receivedAt;
}

function normalizeTimestamp(value: number): number | null {
    if (!Number.isFinite(value)) {
        return null;
    }

    const normalized = Math.trunc(value);
    return normalized >= 0 ? normalized : null;
}
