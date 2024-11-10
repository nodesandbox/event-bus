import { Channel, Connection, connect, ConsumeMessage } from "amqplib";
import { v4 as uuid } from "uuid";
import { EventBus, EventBusOptions, PublishOptions, SubscribeOptions, ValidatedEventBusOptions } from "../../interfaces";
import { MessageStore } from "./stores/message-store";
import { IdempotencyStore } from "./stores/indempotency";
import { ConnectionHandler } from "./handlers/connection-handler";
import { MessageHandler } from "./handlers/message-handler";
import { DeadLetterHandler } from "./handlers/dl-handler";
import { CloudEvent } from "../../types";
import { MessageProcessingError } from "./errors";
import { validateAndMergeOptions } from "../utils/bus-options-validator";

export class RabbitMQEventBus<E extends string = string> implements EventBus<E> {
    private connection?: Connection;
    private channel?: Channel;
    private readonly options: ValidatedEventBusOptions;
    private isInitialized = false;
    private reconnectAttempts = 0;
    private messageStore: MessageStore;
    private boundQueues: Set<string>;
    private idempotencyStore: IdempotencyStore;
    
    
    private connectionHandler: ConnectionHandler;
    private messageHandler?: MessageHandler<E>;
    private deadLetterHandler?: DeadLetterHandler;

    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAYS = [1000, 5000, 15000];
    private readonly RECONNECT_DELAY = 5000;
    private readonly MAX_RECONNECT_ATTEMPTS = 10;
    private readonly DLQ_RETENTION = 7 * 24 * 60 * 60 * 1000;
    private readonly QUEUE_MAX_LENGTH = 10000;

    constructor(options: EventBusOptions) {
        this.options = validateAndMergeOptions(options);
        this.messageStore = new MessageStore();
        this.boundQueues = new Set();
        this.idempotencyStore = new IdempotencyStore();
        
        this.connectionHandler = new ConnectionHandler(
            this.reconnect.bind(this),
            this.recreateChannel.bind(this)
        );
    }

    private validateState(): void {
        if (!this.isInitialized) {
            throw new Error("EventBus not initialized. Call init() first.");
        }
        if (!this.connection || !this.channel) {
            throw new Error("Connection or channel not available.");
        }
    }

    async init(): Promise<void> {
        try {
            await this.connect();
            await this.setupExchangesAndQueues();
            await this.initializeHandlers();
            this.setupEventHandlers();
            
            this.isInitialized = true;
            console.log("RabbitMQ EventBus initialized successfully");

            await this.republishStoredMessages();
        } catch (error) {
            console.error("Failed to initialize RabbitMQ EventBus:", error);
            throw error;
        }
    }

    private async connect(): Promise<void> {
        try {
            this.connection = await connect(this.options.connection.url);
            this.channel = await this.connection.createChannel();
            this.reconnectAttempts = 0;
            console.log("Connected to RabbitMQ successfully");
        } catch (error) {
            this.reconnectAttempts++;
            if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
                console.warn(
                    `Connection attempt ${this.reconnectAttempts} failed, retrying in ${this.RECONNECT_DELAY}ms`
                );
                await new Promise((resolve) => setTimeout(resolve, this.RECONNECT_DELAY));
                return this.connect();
            }
            throw error;
        }
    }

    private async initializeHandlers(): Promise<void> {
        if (!this.channel) throw new Error("Channel not initialized");

        this.messageHandler = new MessageHandler(
            this.channel,
            this.idempotencyStore,
            this.options,
            {
                maxRetries: this.MAX_RETRIES,
                delays: this.RETRY_DELAYS,
                retryExchange: this.options.connection.retryExchange,
                deadLetterExchange: this.options.connection.deadLetterExchange,
            }
        );

        this.deadLetterHandler = new DeadLetterHandler(
            this.channel,
            this.MAX_RETRIES,
            this.options.connection.retryExchange
        );
    }

    private async setupExchangesAndQueues(): Promise<void> {
        if (!this.channel) throw new Error("Channel not initialized");

        await Promise.all([
            this.channel.assertExchange(
                this.options.connection.exchange,
                this.options.connection.exchangeType,
                { durable: true }
            ),
            this.channel.assertExchange(
                this.options.connection.retryExchange,
                "direct",
                { durable: true }
            ),
            this.channel.assertExchange(
                this.options.connection.deadLetterExchange,
                "topic",
                { durable: true }
            )
        ]);

        const dlqName = `${this.options.connection.exchange}.dlq`;
        await this.channel.assertQueue(dlqName, {
            durable: true,
            arguments: {
                "x-message-ttl": this.DLQ_RETENTION,
                "x-max-length": this.QUEUE_MAX_LENGTH,
                "x-overflow": "reject-publish",
            },
        });

        await this.channel.bindQueue(
            dlqName,
            this.options.connection.deadLetterExchange,
            "#"
        );

        await this.deadLetterHandler?.setupDeadLetterConsumer(dlqName);
    }

    private setupEventHandlers(): void {
        if (!this.connection || !this.channel) return;

        this.connection.on("error", this.connectionHandler.handleConnectionError.bind(this.connectionHandler));
        this.connection.on("close", this.connectionHandler.handleConnectionClosed.bind(this.connectionHandler));

        this.channel.on("error", this.connectionHandler.handleChannelError.bind(this.connectionHandler));
        this.channel.on("close", this.connectionHandler.handleChannelClosed.bind(this.connectionHandler));
        this.channel.on("return", this.handleUnroutableMessage.bind(this));
    }

    private handleUnroutableMessage(msg: ConsumeMessage): void {
        console.log("Message returned as unroutable, storing for later delivery:", {
            exchange: msg.fields.exchange,
            routingKey: msg.fields.routingKey,
            messageId: msg.properties.messageId,
        });

        this.messageStore.add(msg.fields.routingKey, msg.content, msg.properties);
    }

    private async republishStoredMessages(): Promise<void> {
        if (!this.channel) return;

        const messages = this.messageStore.getAll();
        if (messages.length === 0) return;

        console.log(`Attempting to republish ${messages.length} stored messages`);

        for (const message of messages) {
            const { routingKey, content, options } = message;

            if (this.hasBindingForRoutingKey(routingKey)) {
                try {
                    await this.channel.publish(
                        this.options.connection.exchange,
                        routingKey,
                        content,
                        options
                    );
                    console.log(`Successfully republished message to ${routingKey}`);
                } catch (error) {
                    console.error(`Failed to republish message to ${routingKey}:`, error);
                }
            }
        }
    }

    private hasBindingForRoutingKey(routingKey: string): boolean {
        return Array.from(this.boundQueues).some((binding) => {
            const pattern = binding
                .replace(".", "\\.")
                .replace("*", "[^.]+")
                .replace("#", ".*");
            return new RegExp(`^${pattern}$`).test(routingKey);
        });
    }

    async publish<T>(
        event: CloudEvent<T, E>,
        options?: PublishOptions
    ): Promise<void> {
        this.validateState();
        if (!this.channel) throw new Error("Channel not initialized");

        const content = Buffer.from(JSON.stringify(event));
        const messageId = event.metadata.id || uuid();
        const timestamp = Date.now();

        try {
            const published = await this.channel.publish(
                this.options.connection.exchange,
                event.type,
                content,
                {
                    persistent: this.options.producer.persistent,
                    mandatory: this.options.producer.mandatory,
                    messageId,
                    timestamp,
                    headers: {
                        'x-event-id': messageId,
                        'x-published-timestamp': timestamp,
                        'x-correlation-id': event.metadata.correlationId,
                        'x-source': event.metadata.source,
                        'x-deduplication-id': `${event.type}-${messageId}`,
                        ...options?.headers
                    },
                    ...options
                }
            );

            if (!published) {
                throw new Error('Message was not confirmed by the broker');
            }
        } catch (error) {
            throw new MessageProcessingError(
                `Failed to publish event ${messageId}`,
                error as Error
            );
        }
    }

    async subscribe<T>(
        type: E | E[],
        handler: (event: CloudEvent<T, E>) => Promise<void>,
        options?: SubscribeOptions
    ): Promise<void> {
        this.validateState();
        if (!this.channel || !this.messageHandler) {
            throw new Error("Channel or message handler not initialized");
        }

        const types = Array.isArray(type) ? type : [type];
        const queueName = options?.queue || uuid();

        try {
            const { queue } = await this.channel.assertQueue(queueName, {
                exclusive: options?.exclusive ?? !options?.queue,
                durable: true,
                arguments: {
                    "x-dead-letter-exchange": this.options.connection.deadLetterExchange,
                    "x-message-ttl": 24 * 60 * 60 * 1000,
                    "x-max-length": this.QUEUE_MAX_LENGTH,
                    "x-overflow": "reject-publish",
                },
            });

            for (const eventType of types) {
                await this.channel.bindQueue(
                    queue,
                    this.options.connection.exchange,
                    eventType
                );
                this.boundQueues.add(eventType);
            }

            await this.channel.prefetch(this.options.consumer.prefetch);

            await this.channel.consume(
                queue,
                async (msg) => {
                    if (!msg) return;
                    await this.messageHandler?.handleMessage(msg, handler);
                },
                { noAck: false }
            );

            await this.republishStoredMessages();
        } catch (error) {
            console.error(`Failed to subscribe to ${types.join(", ")}:`, error);
            throw error;
        }
    }

    private async reconnect(): Promise<void> {
        this.isInitialized = false;
        try {
            await this.init();
        } catch (error) {
            console.error("Failed to reconnect:", error);
            setTimeout(() => this.reconnect(), this.RECONNECT_DELAY);
        }
    }

    private async recreateChannel(): Promise<void> {
        try {
            if (!this.connection) throw new Error("No connection available");
            this.channel = await this.connection.createChannel();
            await this.setupExchangesAndQueues();
            await this.initializeHandlers();
            console.log("Channel recreated successfully");
        } catch (error) {
            console.error("Failed to recreate channel:", error);
            await this.reconnect();
        }
    }

    async unsubscribe(consumerTag: string): Promise<void> {
        if (!this.channel) {
            throw new Error("Channel not initialized");
        }

        try {
            await this.channel.cancel(consumerTag);
            console.log(`Unsubscribed consumer ${consumerTag}`);
        } catch (error) {
            console.error(`Failed to unsubscribe consumer ${consumerTag}:`, error);
            throw error;
        }
    }

    async close(): Promise<void> {
        try {
            if (this.channel) {
                await this.channel.close();
                this.channel = undefined;
            }
            if (this.connection) {
                await this.connection.close();
                this.connection = undefined;
            }
            this.isInitialized = false;
            console.log("RabbitMQ EventBus closed successfully");
        } catch (error) {
            throw new MessageProcessingError(
                "Failed to close RabbitMQ connection",
                error as Error
            );
        }
    }
}