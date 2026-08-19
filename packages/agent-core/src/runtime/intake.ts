import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Lane, RuntimeInput } from "./types";

export const dropReasonSchema = z.enum(["buffer_full", "priority_buffer_full", "lane_drop", "self_echo", "duplicate"]);
export type DropReason = z.infer<typeof dropReasonSchema>;

const defaultIntakeConfig = {
    mode: "lossless" as const,
    generalSlots: 32,
    reservedSlots: 8,
    mergeWindowMs: 0,
    alwaysKeep: [] as string[],
};
const intakeConfigSchema = z.object({
    mode: z.enum(["lossless", "lossy"]).default("lossless"),
    generalSlots: z.number().int().nonnegative().default(32),
    reservedSlots: z.number().int().nonnegative().default(8),
    mergeWindowMs: z.number().int().nonnegative().default(0),
    alwaysKeep: z.array(z.string().min(1)).default([]),
});

/**
 * L1 闸门配置（README 分流策略里的 reply 块）。maxChars 为 0 表示不限长，
 * rateLimitPerMin 为 0 表示不限频——两者都省略时该 channel 的回复侧没有闸门。
 */
const replyConfigSchema = z.object({
    maxChars: z.number().int().nonnegative().default(0),
    rateLimitPerMin: z.number().int().nonnegative().default(0),
});
const defaultReplyConfig = { maxChars: 0, rateLimitPerMin: 0 };

const channelPolicySchema = z.object({
    lane: z.record(z.string(), z.enum(["fast", "deep"])).default({}),
    intake: intakeConfigSchema.default(defaultIntakeConfig),
    reply: replyConfigSchema.default(defaultReplyConfig),
});

/**
 * 已见过的 (channel, platformMessageId) 上限。平台按设计会重复推送相同消息 id，
 * 去重键必须跨 turn 存活；但不能无界增长，故按 FIFO 截断最早的记录。
 */
const DEDUPE_CAPACITY = 4096;

export const intakePolicySchema = z.object({
    channels: z.record(z.string(), channelPolicySchema).default({}),
    defaults: z
        .object({
            lane: z.enum(["fast", "deep"]).default("deep"),
            intake: intakeConfigSchema.default(defaultIntakeConfig),
            reply: replyConfigSchema.default(defaultReplyConfig),
        })
        .default({ lane: "deep", intake: defaultIntakeConfig, reply: defaultReplyConfig }),
});
export type IntakePolicy = z.infer<typeof intakePolicySchema>;
export type ReplyPolicy = z.infer<typeof replyConfigSchema>;

export type AdmissionResult =
    | { disposition: "accepted"; lane: Lane; batchId?: string }
    | { disposition: "merged"; lane: Lane; batchId: string }
    | { disposition: "dropped"; lane: Lane; reason: DropReason };

/**
 * 去重键为 (channel, platformMessageId)。没有 platformMessageId 的事件（本地输入、
 * admin 调试注入）无法去重，返回 undefined 表示跳过该判定而不是当作同一个键。
 *
 * 分隔符用 NUL：它不可能出现在 channel 名或平台消息 id 里，避免拼接歧义。
 * 回放侧（history.ts）必须用同一个函数生成键，否则重启后预热的键永远匹配不上。
 */
export function platformDedupeKey(event: { channel: string; platformMessageId?: string }): string | undefined {
    if (event.platformMessageId === undefined) return undefined;
    return `${event.channel}\u0000${event.platformMessageId}`;
}

type Pending = { event: RuntimeInput; lane: Lane; batchId?: string };

export class IntakeController {
    private readonly pending: Pending[] = [];
    private readonly policy: IntakePolicy;
    private readonly seen = new Set<string>();
    private nextBatch = 1;

    public constructor(policy: IntakePolicy = intakePolicySchema.parse({})) {
        this.policy = policy;
    }

    /**
     * 用回放得到的 (channel, platformMessageId) 键预热去重集合，使重启后仍能识别平台重复投递。
     */
    public seedSeenPlatformMessages(keys: Iterable<string>): void {
        for (const key of keys) this.remember(key);
    }

    public admit(event: RuntimeInput): AdmissionResult {
        const channel = this.policy.channels[event.channel];
        const intake = channel?.intake ?? this.policy.defaults.intake;
        const lane = channel?.lane[event.kind] ?? event.laneHint ?? channel?.lane.chat ?? this.policy.defaults.lane;
        if (event.author.isSelf) return { disposition: "dropped", lane, reason: "self_echo" };

        // 去重先于缓冲判定：重复投递不该占用槽位，也不该因缓冲满而被记成另一种 reason。
        const dedupeKey = platformDedupeKey(event);
        if (dedupeKey !== undefined) {
            if (this.seen.has(dedupeKey)) return { disposition: "dropped", lane, reason: "duplicate" };
            this.remember(dedupeKey);
        }

        if (intake.mode === "lossless") {
            this.pending.push({ event, lane });
            return { disposition: "accepted", lane };
        }

        const conversationPending = this.pending.filter(
            (item) => item.event.channel === event.channel && item.event.conversationId === event.conversationId,
        );
        const recent = conversationPending.find(
            (item) => intake.mergeWindowMs > 0 && event.receivedAt - item.event.receivedAt <= intake.mergeWindowMs,
        );
        if (recent) {
            const batchId = recent.batchId ?? `batch-${this.nextBatch++}`;
            recent.batchId = batchId;
            this.pending.push({ event, lane, batchId });
            return { disposition: "merged", lane, batchId };
        }

        const priority = intake.alwaysKeep.includes(event.kind);
        const generalCount = conversationPending.filter(
            (item) => !this.isPriority(item.event, item.event.channel),
        ).length;
        const priorityCount = conversationPending.length - generalCount;
        const limit = priority ? intake.reservedSlots : intake.generalSlots;
        const count = priority ? priorityCount : generalCount;
        if (count >= limit) {
            return { disposition: "dropped", lane, reason: priority ? "priority_buffer_full" : "buffer_full" };
        }

        const batchId = intake.mergeWindowMs > 0 ? `batch-${this.nextBatch++}` : undefined;
        this.pending.push({ event, lane, batchId });
        return { disposition: "accepted", lane, ...(batchId ? { batchId } : {}) };
    }

    public release(events: RuntimeInput[]): void {
        for (const event of events) {
            const index = this.pending.findIndex((item) => item.event.inputId === event.inputId);
            if (index >= 0) this.pending.splice(index, 1);
        }
    }

    public batchId(event: RuntimeInput): string | undefined {
        return this.pending.find((item) => item.event.inputId === event.inputId)?.batchId;
    }

    private isPriority(event: RuntimeInput, channelName: string): boolean {
        return (this.policy.channels[channelName]?.intake ?? this.policy.defaults.intake).alwaysKeep.includes(
            event.kind,
        );
    }

    private remember(key: string): void {
        this.seen.add(key);
        if (this.seen.size <= DEDUPE_CAPACITY) return;
        const oldest = this.seen.values().next();
        if (!oldest.done) this.seen.delete(oldest.value);
    }
}

export function loadIntakePolicy(path?: string): IntakePolicy {
    if (!path) return intakePolicySchema.parse({});
    let value: unknown;
    try {
        value = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        throw new Error(`channel policy cannot be loaded: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
    return intakePolicySchema.parse(value);
}
