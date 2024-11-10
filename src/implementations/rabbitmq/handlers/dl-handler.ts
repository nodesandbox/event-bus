import { Channel, ConsumeMessage } from "amqplib";
import { DeadLetterDetails } from "../types";

export class DeadLetterHandler {
    constructor(
        private channel: Channel,
        private maxRetries: number,
        private retryExchange: string
    ) {}

    async setupDeadLetterConsumer(dlqName: string): Promise<void> {
        if (!this.channel) return;

        await this.channel.consume(
            dlqName,
            async (msg) => {
                if (!msg) return;

                try {
                    const details = this.extractDeadLetterDetails(msg);
                    await this.handleDeadLetter(details);
                    await this.channel?.ack(msg);
                } catch (error) {
                    console.error("Error processing dead letter:", error);
                    await this.channel?.reject(msg, false);
                }
            },
            { noAck: false }
        );
    }

    private extractDeadLetterDetails(msg: ConsumeMessage): DeadLetterDetails {
        const headers = msg.properties.headers || {};
        const deathInfo = headers["x-death"]?.[0] || ({} as any);

        return {
            messageId: msg.properties.messageId || "unknown",
            failureReason: headers["x-failure-reason"] || "Unknown failure",
            retryCount: headers["x-retry-count"] || 0,
            timestamp: new Date().toISOString(),
            originalExchange: deathInfo.exchange || "",
            originalRoutingKey: deathInfo.routingKey || "",
            content: msg.content.toString(),
            headers: headers,
            error: headers["x-error-message"]
                ? new Error(headers["x-error-message"])
                : undefined,
        };
    }

    private async handleDeadLetter(details: DeadLetterDetails): Promise<void> {
        console.error("Dead Letter Processing:", {
            messageId: details.messageId,
            failureReason: details.failureReason,
            retryCount: details.retryCount,
            timestamp: details.timestamp,
        });

        if (this.shouldAttemptRecovery(details)) {
            await this.attemptMessageRecovery(details);
        } else {
            await this.notifyDeadLetter(details);
            this.incrementDeadLetterMetrics(details);
        }
    }

    private shouldAttemptRecovery(details: DeadLetterDetails): boolean {
        const recoverableErrors = ["ConnectionError", "TimeoutError"];
        return (
            recoverableErrors.includes(details.error?.name || "") &&
            details.retryCount < this.maxRetries
        );
    }

    private async attemptMessageRecovery(
        details: DeadLetterDetails
    ): Promise<void> {
        if (!this.channel) throw new Error("Channel not initialized");

        try {
            await this.channel.publish(
                this.retryExchange as string,
                details.originalRoutingKey,
                Buffer.from(details.content),
                {
                    headers: {
                        ...details.headers,
                        "x-retry-count": details.retryCount + 1,
                        "x-recovery-attempt": true,
                        "x-original-error": details.error?.message,
                    },
                }
            );

            console.log(
                `Recovery attempt initiated for message ${details.messageId}`
            );
        } catch (error) {
            console.error("Recovery attempt failed:", error);
            throw error;
        }
    }

    private async notifyDeadLetter(details: DeadLetterDetails): Promise<void> {
        console.log("Dead Letter Notification:", {
            messageId: details.messageId,
            failureReason: details.failureReason,
            retryCount: details.retryCount,
            timestamp: details.timestamp,
        });
    }

    private incrementDeadLetterMetrics(details: DeadLetterDetails): void {
        console.log("Dead Letter Metrics:", {
            routingKey: details.originalRoutingKey,
            exchange: details.originalExchange,
            failureReason: details.failureReason,
            retryCount: details.retryCount,
        });
    }
}