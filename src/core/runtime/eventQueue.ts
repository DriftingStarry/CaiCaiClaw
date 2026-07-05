import { InboundEvent } from "./types.js";

type QueueWaiter = (events: InboundEvent[]) => void;

export class EventQueue {
    private queue: InboundEvent[] = [];
    private waiters: QueueWaiter[] = [];

    public enqueue(event: InboundEvent): void {
        this.queue.push(event);

        const waiter = this.waiters.shift();
        if (waiter) {
            waiter(this.drain());
        }
    }

    public drain(): InboundEvent[] {
        const events = this.queue;
        this.queue = [];
        return events;
    }

    public async drainWithin(timeoutMs: number): Promise<InboundEvent[]> {
        const existing = this.drain();
        if (existing.length > 0) return existing;

        return await new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.waiters = this.waiters.filter((waiter) => waiter !== wake);
                resolve([]);
            }, timeoutMs);

            const wake = (events: InboundEvent[]) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(events);
            };

            this.waiters.push(wake);
        });
    }

    public wakeStopped(): void {
        const waiter = this.waiters.shift();
        if (waiter) {
            waiter([]);
        }
    }
}

