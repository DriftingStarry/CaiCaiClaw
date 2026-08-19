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

const channelPolicySchema = z.object({
    lane: z.record(z.string(), z.enum(["fast", "deep"])).default({}),
    intake: intakeConfigSchema.default(defaultIntakeConfig),
});

export const intakePolicySchema = z.object({
    channels: z.record(z.string(), channelPolicySchema).default({}),
    defaults: z
        .object({
            lane: z.enum(["fast", "deep"]).default("deep"),
            intake: intakeConfigSchema.default(defaultIntakeConfig),
        })
        .default({ lane: "deep", intake: defaultIntakeConfig }),
});
export type IntakePolicy = z.infer<typeof intakePolicySchema>;

export type AdmissionResult =
    | { disposition: "accepted"; lane: Lane; batchId?: string }
    | { disposition: "merged"; lane: Lane; batchId: string }
    | { disposition: "dropped"; lane: Lane; reason: DropReason };

type Pending = { event: RuntimeInput; lane: Lane; batchId?: string };

export class IntakeController {
    private readonly pending: Pending[] = [];
    private readonly policy: IntakePolicy;
    private nextBatch = 1;

    public constructor(policy: IntakePolicy = intakePolicySchema.parse({})) {
        this.policy = policy;
    }

    public admit(event: RuntimeInput): AdmissionResult {
        const channel = this.policy.channels[event.channel];
        const intake = channel?.intake ?? this.policy.defaults.intake;
        const lane = channel?.lane[event.kind] ?? event.laneHint ?? channel?.lane.chat ?? this.policy.defaults.lane;
        if (event.author.isSelf) return { disposition: "dropped", lane, reason: "self_echo" };
        if (intake.mode === "lossless") {
            this.pending.push({ event, lane });
            return { disposition: "accepted", lane };
        }

        const priority = intake.alwaysKeep.includes(event.kind);
        const conversationPending = this.pending.filter(
            (item) => item.event.channel === event.channel && item.event.conversationId === event.conversationId,
        );
        const generalCount = conversationPending.filter(
            (item) => !this.isPriority(item.event, item.event.channel),
        ).length;
        const priorityCount = conversationPending.length - generalCount;
        const limit = priority ? intake.reservedSlots : intake.generalSlots;
        const count = priority ? priorityCount : generalCount;
        if (count >= limit) {
            return { disposition: "dropped", lane, reason: priority ? "priority_buffer_full" : "buffer_full" };
        }

        const recent = conversationPending.find(
            (item) =>
                item.event.conversationId === event.conversationId &&
                item.event.channel === event.channel &&
                intake.mergeWindowMs > 0 &&
                event.receivedAt - item.event.receivedAt <= intake.mergeWindowMs,
        );
        const batchId = recent?.batchId ?? (intake.mergeWindowMs > 0 ? `batch-${this.nextBatch++}` : undefined);
        this.pending.push({ event, lane, batchId });
        if (recent) return { disposition: "merged", lane, batchId: batchId as string };
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
