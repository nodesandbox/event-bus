export class IdempotencyStore {
    private processedMessages: Map<string, { timestamp: number; result?: any }> = new Map();
    private readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 heures

    constructor() {
        setInterval(() => this.cleanup(), 60 * 60 * 1000); // Cleanup toutes les heures
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
            if (now - value.timestamp > this.TTL_MS) this.processedMessages.delete(key);
        });
    }
}
