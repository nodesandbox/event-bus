import { v4 as uuid } from "uuid";

export class MessageStore {
    private messages: Map<string, { content: Buffer; routingKey: string; options: any; timestamp: number }> = new Map();

    add(routingKey: string, content: Buffer, options: any): void {
        const messageId = options.messageId || uuid();
        this.messages.set(messageId, { content, routingKey, options, timestamp: Date.now() });
    }

    getAll(): Array<{ routingKey: string; content: Buffer; options: any; timestamp: number }> {
        return Array.from(this.messages.values());
    }

    clear(): void {
        this.messages.clear();
    }
}
