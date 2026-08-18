import { RuntimeInput } from "./types";

type QueueWaiter = (events: RuntimeInput[]) => void;

export class EventQueue {
    private queue: RuntimeInput[] = [];
    private waiters: QueueWaiter[] = [];

    public enqueue(event: RuntimeInput): void {
        this.queue.push(event);

        const waiter = this.waiters.shift();
        if (waiter) {
            waiter(this.drain());
        }
    }

    public drain(): RuntimeInput[] {
        const events = this.queue;
        this.queue = [];
        return events;
    }

    public get size(): number {
        return this.queue.length;
    }

    public async drainWithin(timeoutMs: number): Promise<RuntimeInput[]> {
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

            const wake = (events: RuntimeInput[]) => {
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

    public wake(): void {
        const waiter = this.waiters.shift();
        if (waiter) waiter([]);
    }
}
