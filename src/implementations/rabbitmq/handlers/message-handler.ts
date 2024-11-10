// src/eventbus/handlers/message-handler.ts
import { Channel, ConsumeMessage } from "amqplib";
import { RetryableError } from "../errors";
import { IdempotencyStore } from "../stores/indempotency";
import { CloudEvent } from "../../../types";

export class MessageHandler<E extends string = string> {
    constructor(
        private channel: Channel,
        private idempotencyStore: IdempotencyStore,
        private options: any,
        private retryConfig: {
            maxRetries: number;
            delays: number[];
            retryExchange: string;
            deadLetterExchange: string;
        }
    ) {}

    private parseEvent<T>(msg: ConsumeMessage): CloudEvent<T, E> {
        try {
            return JSON.parse(msg.content.toString()) as CloudEvent<T, E>;
        } catch (error) {
            throw new Error(`Failed to parse message content: ${error}`);
        }
    }

    async handleMessage<T>(
        msg: ConsumeMessage,
        handler: (event: CloudEvent<T, E>) => Promise<void>
    ): Promise<void> {
        if (!this.channel) throw new Error("Channel not initialized");

        const messageId = msg.properties.messageId || 
                         msg.properties.headers?.["x-event-id"] || 
                         "unknown";
        const retryCount = (msg.properties.headers?.["x-retry-count"] as number) || 0;
        const startTime = Date.now();

        try {
            const { processed, result } = await this.idempotencyStore.hasBeenProcessed(messageId);

            if (processed) {
                console.log(`[${messageId}] Message already processed, skipping`);
                await this.channel.ack(msg);
                return;
            }

            const event = this.parseEvent<T>(msg);
            console.log(`[${messageId}] Processing message (attempt ${retryCount + 1}/${this.retryConfig.maxRetries + 1})`);

            await handler(event);
            await this.idempotencyStore.markAsProcessed(messageId);

            const processTime = Date.now() - startTime;
            console.log(`[${messageId}] Successfully processed message in ${processTime}ms`);

            if (!this.options.consumer.autoAck) {
                await this.channel.ack(msg);
            }
        } catch (error) {
            const processTime = Date.now() - startTime;

            if (error instanceof RetryableError && retryCount < this.retryConfig.maxRetries) {
                await this.handleRetryableError(msg, error, retryCount);
            } else {
                await this.handleNonRetryableError(msg, error as Error);
            }

            console.error(`[${messageId}] Message processing failed after ${processTime}ms:`, error);
        }
    }

    private async handleRetryableError(
        msg: ConsumeMessage,
        error: Error,
        retryCount: number
    ): Promise<void> {
        if (!this.channel) return;

        const nextRetryDelay = this.retryConfig.delays[retryCount];
        const headers = {
            ...msg.properties.headers,
            "x-retry-count": retryCount + 1,
            "x-last-retry-timestamp": Date.now(),
            "x-next-retry-delay": nextRetryDelay,
            "x-last-error": error.message,
            "x-error-stack": error.stack,
        };

        try {
            await new Promise((resolve) => setTimeout(resolve, nextRetryDelay));

            const published = await this.channel.publish(
                this.retryConfig.retryExchange,
                msg.fields.routingKey,
                msg.content,
                { ...msg.properties, headers }
            );

            if (published) {
                await this.channel.ack(msg);
                console.log(`Message requeued for retry ${retryCount + 1}/${this.retryConfig.maxRetries}`);
            } else {
                throw new Error("Failed to publish retry message");
            }
        } catch (retryError) {
            console.error("Failed to handle retryable error:", retryError);
            await this.handleNonRetryableError(msg, error);
        }
    }

    private async handleNonRetryableError(
        msg: ConsumeMessage,
        error: Error
    ): Promise<void> {
        if (!this.channel) return;

        const headers = {
            ...msg.properties.headers,
            "x-failure-reason": error.message,
            "x-failed-timestamp": Date.now(),
            "x-error-type": error.name,
            "x-error-stack": error.stack,
            "x-original-exchange": msg.fields.exchange,
            "x-original-routing-key": msg.fields.routingKey,
        };

        try {
            const published = await this.channel.publish(
                this.retryConfig.deadLetterExchange,
                "dead.letter",
                msg.content,
                { ...msg.properties, headers }
            );

            if (published) {
                await this.channel.ack(msg);
                console.log(`Message moved to DLQ: ${msg.properties.messageId}`);
            } else {
                throw new Error("Failed to publish to DLQ");
            }
        } catch (dlqError) {
            console.error("Failed to move message to DLQ:", dlqError);
            await this.channel.reject(msg, false);
        }
    }
}