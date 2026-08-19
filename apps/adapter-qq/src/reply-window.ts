import { QQ_PASSIVE_MAX_REPLIES, QQ_PASSIVE_WINDOW_MS, type QqSendScope } from "./api-client";

export type ClaimResult =
    | { ok: true; scope: QqSendScope; msgSeq: number }
    | { ok: false; reason: "unknown_message" | "window_expired" | "quota_exhausted"; detail: string };

type TrackedMessage = {
    scope: QqSendScope;
    occurredAtMs: number;
    registeredAtMs: number;
    registrationOrder: number;
    usedReplies: number;
    nextMsgSeq: number;
    latestClaimedMsgSeq?: number;
};

// 限制登记数量，避免异常或失联消息无限累积导致内存无界增长。
const MAX_TRACKED_MESSAGES = 4096;

export class ReplyWindowTracker {
    private readonly now: () => number;
    private readonly messages = new Map<string, TrackedMessage>();
    private nextRegistrationOrder = 0;

    constructor({ now = () => Date.now() }: { now?: () => number } = {}) {
        this.now = now;
    }

    register(scope: QqSendScope, msgId: string, occurredAtMs: number): void {
        if (this.messages.has(msgId)) {
            return;
        }

        this.prune();
        this.messages.set(msgId, {
            scope,
            occurredAtMs,
            registeredAtMs: this.now(),
            registrationOrder: this.nextRegistrationOrder++,
            usedReplies: 0,
            nextMsgSeq: 1,
        });

        while (this.messages.size > MAX_TRACKED_MESSAGES) {
            this.evictEarliestRegistration();
        }
    }

    claim(msgId: string): ClaimResult {
        const message = this.messages.get(msgId);
        if (message === undefined) {
            return {
                ok: false,
                reason: "unknown_message",
                detail: "消息未登记，无法使用被动回复窗口",
            };
        }

        const elapsedMs = this.now() - message.occurredAtMs;
        const windowMs = QQ_PASSIVE_WINDOW_MS[message.scope];
        if (elapsedMs >= windowMs) {
            return {
                ok: false,
                reason: "window_expired",
                detail: `被动回复窗口已过期：已过去 ${elapsedMs} 毫秒，窗口为 ${windowMs} 毫秒`,
            };
        }

        const maxReplies = QQ_PASSIVE_MAX_REPLIES[message.scope];
        if (message.usedReplies >= maxReplies) {
            return {
                ok: false,
                reason: "quota_exhausted",
                detail: `被动回复次数已用满：已用 ${message.usedReplies} 次，上限为 ${maxReplies} 次`,
            };
        }

        const msgSeq = message.nextMsgSeq;
        message.nextMsgSeq += 1;
        message.usedReplies += 1;
        message.latestClaimedMsgSeq = msgSeq;
        return { ok: true, scope: message.scope, msgSeq };
    }

    release(msgId: string, msgSeq: number): void {
        const message = this.messages.get(msgId);
        if (message === undefined || message.latestClaimedMsgSeq !== msgSeq) {
            return;
        }

        message.usedReplies -= 1;
        message.nextMsgSeq = msgSeq;
        message.latestClaimedMsgSeq = undefined;
    }

    prune(): number {
        const nowMs = this.now();
        let prunedCount = 0;

        for (const [msgId, message] of this.messages) {
            if (nowMs - message.occurredAtMs >= QQ_PASSIVE_WINDOW_MS[message.scope]) {
                this.messages.delete(msgId);
                prunedCount += 1;
            }
        }

        return prunedCount;
    }

    size(): number {
        return this.messages.size;
    }

    private evictEarliestRegistration(): void {
        let earliestMsgId: string | undefined;
        let earliestMessage: TrackedMessage | undefined;

        for (const [msgId, message] of this.messages) {
            if (
                earliestMessage === undefined ||
                message.registeredAtMs < earliestMessage.registeredAtMs ||
                (message.registeredAtMs === earliestMessage.registeredAtMs &&
                    message.registrationOrder < earliestMessage.registrationOrder)
            ) {
                earliestMsgId = msgId;
                earliestMessage = message;
            }
        }

        if (earliestMsgId !== undefined) {
            this.messages.delete(earliestMsgId);
        }
    }
}
