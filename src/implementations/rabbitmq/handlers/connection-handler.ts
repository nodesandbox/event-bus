import { Channel, Connection } from "amqplib";

export class ConnectionHandler {
    constructor(
        private reconnect: () => Promise<void>,
        private recreateChannel: () => Promise<void>
    ) {}

    async handleConnectionError(error: Error): Promise<void> {
        console.error("Connection error:", error);
        await this.reconnect();
    }

    async handleConnectionClosed(): Promise<void> {
        console.warn("Connection closed, attempting to reconnect...");
        await this.reconnect();
    }

    async handleChannelError(error: Error): Promise<void> {
        console.error("Channel error:", error);
        await this.recreateChannel();
    }

    async handleChannelClosed(): Promise<void> {
        console.warn("Channel closed, attempting to recreate...");
        await this.recreateChannel();
    }
}