import type { IntakePolicy, ReplyPolicy } from "./intake";

/**
 * L1 闸门：回复来源渠道走输出路由（不是 tool），所以限长与限频必须由 runtime 在出站
 * 路径上强制，不能指望 adapter 自觉。README 的分流策略早已定义 reply.maxChars 与
 * reply.rateLimitPerMin，此处是它们的执行点。
 *
 * 两条闸门语义不同，不能混为一谈：
 * - 超长按配置**裁剪**后继续投递（截断优于整条丢弃：用户仍应收到回复）
 * - 超频**拒绝**该次投递并记录（不静默丢弃，调用方须落 outbound.failed）
 */
export type ReplyGateDecision =
    | { allowed: true; text: string; truncatedFrom?: number }
    | { allowed: false; reason: "rate_limited"; detail: string };

const WINDOW_MS = 60_000;

export class ReplyGate {
    private readonly policy: IntakePolicy;
    private readonly now: () => number;
    /** 每 channel 的近一分钟投递时间戳，用于滑动窗口限频。 */
    private readonly recent = new Map<string, number[]>();

    public constructor(policy: IntakePolicy, now: () => number = () => Date.now()) {
        this.policy = policy;
        this.now = now;
    }

    public replyPolicyFor(channel: string): ReplyPolicy {
        return this.policy.channels[channel]?.reply ?? this.policy.defaults.reply;
    }

    /**
     * 对一次完整回复（一个 turn 对某 channel 的对外文本）做裁决。
     * 调用方必须按「一次投递」而不是「一个流式 delta」调用它，否则限频会把
     * 单条回复的多个 delta 记成多次投递。
     */
    public evaluate(channel: string, text: string): ReplyGateDecision {
        const policy = this.replyPolicyFor(channel);

        if (policy.rateLimitPerMin > 0) {
            const timestamps = this.pruneWindow(channel);
            if (timestamps.length >= policy.rateLimitPerMin) {
                return {
                    allowed: false,
                    reason: "rate_limited",
                    detail: `channel ${channel} reached ${policy.rateLimitPerMin} replies per minute`,
                };
            }
            timestamps.push(this.now());
            this.recent.set(channel, timestamps);
        }

        if (policy.maxChars > 0 && text.length > policy.maxChars) {
            return { allowed: true, text: text.slice(0, policy.maxChars), truncatedFrom: text.length };
        }

        return { allowed: true, text };
    }

    private pruneWindow(channel: string): number[] {
        const cutoff = this.now() - WINDOW_MS;
        const kept = (this.recent.get(channel) ?? []).filter((at) => at > cutoff);
        this.recent.set(channel, kept);
        return kept;
    }
}
