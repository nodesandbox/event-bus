import { EventEmitter } from 'events';

export class IdempotencyStore extends EventEmitter {
    private processedMessages: Map<string, { timestamp: number; result?: any }> = new Map();
    private readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 heures
    private cleanupInterval?: NodeJS.Timeout;

    constructor() {
        super();
        this.startCleanupInterval();
    }

    private startCleanupInterval(): void {
        this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000) as NodeJS.Timeout;
    }

    public dispose(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }
        this.processedMessages.clear();
        this.removeAllListeners();
    }

    async markAsProcessed(messageId: string, result?: any): Promise<void> {
        this.processedMessages.set(messageId, { timestamp: Date.now(), result });
    }

    async hasBeenProcessed(messageId: string): Promise<{ processed: boolean; result?: any }> {
        const entry = this.processedMessages.get(messageId);
        return entry ? { processed: true, result: entry.result } : { processed: false };
    }

    private cleanup(): void {
        const now = Date.now();
        this.processedMessages.forEach((value, key) => {
            if (now - value.timestamp > this.TTL_MS) {
                this.processedMessages.delete(key);
            }
        });
    }
}