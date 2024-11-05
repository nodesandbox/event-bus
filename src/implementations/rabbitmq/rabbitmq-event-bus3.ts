import { Channel, Connection, connect, ConsumeMessage } from 'amqplib';
import { v4 as uuid } from 'uuid';
import { EventBus, EventBusOptions, PublishOptions, SubscribeOptions } from '../../interfaces';
import { CloudEvent, EventType } from '../../types';

// Custom Error Classes
class MessageProcessingError extends Error {
  constructor(message: string, public readonly originalError: Error) {
    super(message);
    this.name = 'MessageProcessingError';
  }
}

class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

// Enhanced Dead Letter Interface
interface DeadLetterDetails {
  messageId: string;
  failureReason: string;
  retryCount: number;
  timestamp: string;
  originalExchange: string;
  originalRoutingKey: string;
  content: string;
  headers: Record<string, any>;
  error?: Error;
}

class MessageStore {
  private messages: Map<string, {
    content: Buffer;
    routingKey: string;
    options: any;
    timestamp: number;
  }> = new Map();

  add(routingKey: string, content: Buffer, options: any): void {
    const messageId = options.messageId || uuid();
    this.messages.set(messageId, {
      content,
      routingKey,
      options,
      timestamp: Date.now()
    });
  }

  getAll(): Array<{
    routingKey: string;
    content: Buffer;
    options: any;
    timestamp: number;
  }> {
    return Array.from(this.messages.values());
  }

  clear(): void {
    this.messages.clear();
  }
}

export class RabbitMQEventBus implements EventBus {
  private connection?: Connection;
  private channel?: Channel;
  private readonly options: Required<EventBusOptions>;
  private isInitialized = false;
  private reconnectAttempts = 0;
  private messageStore: MessageStore = new MessageStore();
  private boundQueues: Set<string> = new Set();

  // Constants
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [1000, 5000, 15000]; // Progressive delays in ms
  private readonly RECONNECT_DELAY = 5000; // 5 seconds
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly DLQ_RETENTION = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
  private readonly QUEUE_MAX_LENGTH = 10000;

  constructor(options: EventBusOptions) {
    this.options = {
      connection: {
        exchange: 'events',
        exchangeType: 'topic',
        deadLetterExchange: 'events.dlx',
        retryExchange: 'events.retry',
        ...options.connection,
      },
      consumer: {
        prefetch: 1,
        autoAck: false,
        ...options.consumer,
      },
      producer: {
        persistent: true,
        mandatory: true,
        ...options.producer,
      },
    };
  }

  private validateState(): void {
    if (!this.isInitialized) {
      throw new Error('EventBus not initialized. Call init() first.');
    }
    if (!this.connection || !this.channel) {
      throw new Error('Connection or channel not available.');
    }
  }

  async init(): Promise<void> {
    try {
      await this.connect();
      await this.setupExchangesAndQueues();
      this.setupEventHandlers();
      this.isInitialized = true;
      console.log('RabbitMQ EventBus initialized successfully');
      
      // Try to republish stored messages after initialization
      await this.republishStoredMessages();
    } catch (error) {
      console.error('Failed to initialize RabbitMQ EventBus:', error);
      throw error;
    }
  }

  private async republishStoredMessages(): Promise<void> {
    if (!this.channel) return;

    const messages = this.messageStore.getAll();
    if (messages.length > 0) {
      console.log(`Attempting to republish ${messages.length} stored messages`);
      
      for (const message of messages) {
        const { routingKey, content, options } = message;
        
        // Only republish if we have a binding for this routing key
        if (this.hasBindingForRoutingKey(routingKey)) {
          try {
            await this.channel.publish(
              this.options.connection.exchange as string,
              routingKey,
              content,
              options
            );
            console.log(`Successfully republished message to ${routingKey}`);
          } catch (error) {
            console.error(`Failed to republish message to ${routingKey}:`, error);
          }
        } else {
          console.log(`No binding found for routing key ${routingKey}, keeping message in store`);
        }
      }
    }
  }

  private hasBindingForRoutingKey(routingKey: string): boolean {
    // Check if we have an exact match or a matching pattern
    return Array.from(this.boundQueues).some(binding => {
      // Convert binding pattern to regex
      const pattern = binding
        .replace('.', '\\.')
        .replace('*', '[^.]+')
        .replace('#', '.*');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(routingKey);
    });
  }

  private handleUnroutableMessage(msg: ConsumeMessage): void {
    console.log('Message returned as unroutable, storing for later delivery:', {
      exchange: msg.fields.exchange,
      routingKey: msg.fields.routingKey,
      messageId: msg.properties.messageId
    });

    this.messageStore.add(
      msg.fields.routingKey,
      msg.content,
      msg.properties
    );
  }

  private async connect(): Promise<void> {
    try {
      this.connection = await connect(this.options.connection.url);
      this.channel = await this.connection.createChannel();
      this.reconnectAttempts = 0;
      console.log('Connected to RabbitMQ successfully');
    } catch (error) {
      this.reconnectAttempts++;
      if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        console.warn(`Connection attempt ${this.reconnectAttempts} failed, retrying in ${this.RECONNECT_DELAY}ms`);
        await new Promise(resolve => setTimeout(resolve, this.RECONNECT_DELAY));
        return this.connect();
      }
      throw error;
    }
  }

  private async setupExchangesAndQueues(): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    // Setup main exchange
    await this.channel.assertExchange(
      this.options.connection.exchange as string,
      this.options.connection.exchangeType as string,
      { durable: true }
    );

    // Setup retry exchange
    await this.channel.assertExchange(
      this.options.connection.retryExchange as string,
      'direct',
      { durable: true }
    );

    // Setup dead letter exchange
    await this.channel.assertExchange(
      this.options.connection.deadLetterExchange as string,
      'topic',
      { durable: true }
    );

    // Setup dead letter queue with safer configuration
    const dlqName = `${this.options.connection.exchange}.dlq`;
    try {
      await this.channel.checkQueue(dlqName);
      console.log(`DLQ ${dlqName} already exists, skipping queue creation`);
    } catch (error) {
      if ((error as any).code === 404) {
        await this.channel.assertQueue(dlqName, {
          durable: true,
          arguments: {
            'x-message-ttl': this.DLQ_RETENTION,
            'x-max-length': this.QUEUE_MAX_LENGTH,
            'x-overflow': 'reject-publish'
          }
        });
        console.log(`Created DLQ ${dlqName}`);
      } else {
        throw error;
      }
    }

    await this.channel.bindQueue(
      dlqName,
      this.options.connection.deadLetterExchange as string,
      '#'
    );

    await this.setupDeadLetterConsumer(dlqName);
  }

  private setupEventHandlers(): void {
    if (!this.connection || !this.channel) return;

    // Connection event handlers
    this.connection.on('error', this.handleConnectionError.bind(this));
    this.connection.on('close', this.handleConnectionClosed.bind(this));

    // Channel event handlers
    this.channel.on('error', this.handleChannelError.bind(this));
    this.channel.on('close', this.handleChannelClosed.bind(this));
    this.channel.on('return', this.handleUnroutableMessage.bind(this));
  }

  private async handleConnectionError(error: Error): Promise<void> {
    console.error('Connection error:', error);
    await this.reconnect();
  }

  private async handleConnectionClosed(): Promise<void> {
    console.warn('Connection closed, attempting to reconnect...');
    await this.reconnect();
  }

  private async handleChannelError(error: Error): Promise<void> {
    console.error('Channel error:', error);
    await this.recreateChannel();
  }

  private async handleChannelClosed(): Promise<void> {
    console.warn('Channel closed, attempting to recreate...');
    await this.recreateChannel();
  }

  private async reconnect(): Promise<void> {
    this.isInitialized = false;
    try {
      await this.init();
    } catch (error) {
      console.error('Failed to reconnect:', error);
      setTimeout(() => this.reconnect(), this.RECONNECT_DELAY);
    }
  }

  private async recreateChannel(): Promise<void> {
    try {
      if (!this.connection) throw new Error('No connection available');
      this.channel = await this.connection.createChannel();
      await this.setupExchangesAndQueues();
      console.log('Channel recreated successfully');
    } catch (error) {
      console.error('Failed to recreate channel:', error);
      await this.reconnect();
    }
  }

  private async setupDeadLetterConsumer(dlqName: string): Promise<void> {
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
          console.error('Error processing dead letter:', error);
          await this.channel?.reject(msg, false);
        }
      },
      { noAck: false }
    );
  }

  private extractDeadLetterDetails(msg: ConsumeMessage): DeadLetterDetails {
    const headers = msg.properties.headers || {};
    const deathInfo = headers['x-death']?.[0] || {} as any;

    return {
      messageId: msg.properties.messageId || 'unknown',
      failureReason: headers['x-failure-reason'] || 'Unknown failure',
      retryCount: headers['x-retry-count'] || 0,
      timestamp: new Date().toISOString(),
      originalExchange: deathInfo.exchange || '',
      originalRoutingKey: deathInfo.routingKey || '',
      content: msg.content.toString(),
      headers: headers,
      error: headers['x-error-message'] ? new Error(headers['x-error-message']) : undefined
    };
  }

  private async handleDeadLetter(details: DeadLetterDetails): Promise<void> {
    console.error('Dead Letter Processing:', {
      messageId: details.messageId,
      failureReason: details.failureReason,
      retryCount: details.retryCount,
      timestamp: details.timestamp
    });

    if (this.shouldAttemptRecovery(details)) {
      await this.attemptMessageRecovery(details);
    } else {
      await this.notifyDeadLetter(details);
      this.incrementDeadLetterMetrics(details);
    }
  }

  private shouldAttemptRecovery(details: DeadLetterDetails): boolean {
    const recoverableErrors = ['ConnectionError', 'TimeoutError'];
    return (
      recoverableErrors.includes(details.error?.name || '') &&
      details.retryCount < this.MAX_RETRIES
    );
  }

  private async attemptMessageRecovery(details: DeadLetterDetails): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    try {
      await this.channel.publish(
        this.options.connection.retryExchange as string,
        details.originalRoutingKey,
        Buffer.from(details.content),
        {
          headers: {
            ...details.headers,
            'x-retry-count': details.retryCount + 1,
            'x-recovery-attempt': true,
            'x-original-error': details.error?.message
          }
        }
      );

      console.log(`Recovery attempt initiated for message ${details.messageId}`);
    } catch (error) {
      console.error('Recovery attempt failed:', error);
      throw error;
    }
  }

  private async notifyDeadLetter(details: DeadLetterDetails): Promise<void> {
    console.log('Dead Letter Notification:', {
      messageId: details.messageId,
      failureReason: details.failureReason,
      retryCount: details.retryCount,
      timestamp: details.timestamp
    });
  }

  private incrementDeadLetterMetrics(details: DeadLetterDetails): void {
    console.log('Dead Letter Metrics:', {
      routingKey: details.originalRoutingKey,
      exchange: details.originalExchange,
      failureReason: details.failureReason,
      retryCount: details.retryCount
    });
  }

  async publish<T>(
    event: CloudEvent<T>,
    options?: PublishOptions
  ): Promise<void> {
    this.validateState();

    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const content = Buffer.from(JSON.stringify(event));
    const messageId = event.metadata.id || uuid();
    const timestamp = Date.now();

    try {
      const published = await this.channel.publish(
        this.options.connection.exchange as string,
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
            ...options?.headers
          },
          ...options
        }
      );

      if (!published) {
        throw new Error('Message was not confirmed by the broker');
      }

    } catch (error) {
      const wrappedError = new MessageProcessingError(
        `Failed to publish event ${messageId}`,
        error as Error
      );
      console.error('Publication error:', wrappedError);
      throw wrappedError;
    }
  }

  // private handleUnroutableMessage(msg: ConsumeMessage): void {
  //   console.error('Message returned as unroutable:', {
  //     exchange: msg.fields.exchange,
  //     routingKey: msg.fields.routingKey,
  //     messageId: msg.properties.messageId
  //   });
  // }

  async subscribe<T>(
    type: EventType | EventType[],
    handler: (event: CloudEvent<T>) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<void> {
    this.validateState();

    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const types = Array.isArray(type) ? type : [type];
    const queueName = options?.queue || uuid();

    try {
      const { queue } = await this.channel.assertQueue(queueName, {
        exclusive: options?.exclusive ?? !options?.queue,
        durable: true,
        arguments: {
          'x-dead-letter-exchange': this.options.connection.deadLetterExchange,
          'x-message-ttl': 24 * 60 * 60 * 1000,
          'x-max-length': this.QUEUE_MAX_LENGTH,
          'x-overflow': 'reject-publish'
        }
      });

      // Bind queue to all event types and store bindings
      for (const eventType of types) {
        await this.channel.bindQueue(
          queue,
          this.options.connection.exchange as string,
          eventType
        );
        this.boundQueues.add(eventType);
        console.log(`Bound queue ${queue} to event type ${eventType}`);
      }

      await this.channel.prefetch(this.options.consumer.prefetch as number);

      await this.channel.consume(
        queue,
        async (msg) => {
          if (!msg) return;
          await this.handleMessage(msg, handler);
        },
        { noAck: false }
      );

      // After successful subscription, try to republish stored messages
      await this.republishStoredMessages();

    } catch (error) {
      console.error(`Failed to subscribe to ${types.join(', ')}:`, error);
      throw error;
    }
  }

  private async handleMessage<T>(
    msg: ConsumeMessage,
    handler: (event: CloudEvent<T>) => Promise<void>
  ): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    const messageId = msg.properties.messageId || 'unknown';
    const retryCount = (msg.properties.headers?.['x-retry-count'] as number) || 0;
    const startTime = Date.now();

    try {
      const event = JSON.parse(msg.content.toString()) as CloudEvent<T>;
      console.log(`[${messageId}] Processing message (attempt ${retryCount + 1}/${this.MAX_RETRIES + 1})`);

      await handler(event);

      const processTime = Date.now() - startTime;
      console.log(`[${messageId}] Successfully processed message in ${processTime}ms`);

      if (!this.options.consumer.autoAck) {
        await this.channel.ack(msg);
      }

    } catch (error) {
      const processTime = Date.now() - startTime;

      if (error instanceof RetryableError && retryCount < this.MAX_RETRIES) {
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

    const nextRetryDelay = this.RETRY_DELAYS[retryCount];
    const headers = {
      ...msg.properties.headers,
      'x-retry-count': retryCount + 1,
      'x-last-retry-timestamp': Date.now(),
      'x-next-retry-delay': nextRetryDelay,
      'x-last-error': error.message,
      'x-error-stack': error.stack
    };

    try {
      await new Promise(resolve => setTimeout(resolve, nextRetryDelay));

      const published = await this.channel.publish(
        this.options.connection.retryExchange as string,
        msg.fields.routingKey,
        msg.content,
        { ...msg.properties, headers }
      );

      if (published) {
        await this.channel.ack(msg);
        console.log(`Message requeued for retry ${retryCount + 1}/${this.MAX_RETRIES}`);
      } else {
        throw new Error('Failed to publish retry message');
      }

    } catch (retryError) {
      console.error('Failed to handle retryable error:', retryError);
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
      'x-failure-reason': error.message,
      'x-failed-timestamp': Date.now(),
      'x-error-type': error.name,
      'x-error-stack': error.stack,
      'x-original-exchange': msg.fields.exchange,
      'x-original-routing-key': msg.fields.routingKey
    };

    try {
      const published = await this.channel.publish(
        this.options.connection.deadLetterExchange as string,
        'dead.letter',
        msg.content,
        { ...msg.properties, headers }
      );

      if (published) {
        await this.channel.ack(msg);
        console.log(`Message moved to DLQ: ${msg.properties.messageId}`);
      } else {
        throw new Error('Failed to publish to DLQ');
      }

    } catch (dlqError) {
      console.error('Failed to move message to DLQ:', dlqError);
      await this.channel.reject(msg, false);
    }
  }

  async unsubscribe(consumerTag: string): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not initialized');
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
      console.log('RabbitMQ EventBus closed successfully');
    } catch (error) {
      const wrappedError = new MessageProcessingError(
        'Failed to close RabbitMQ connection',
        error as Error
      );
      console.error('Close error:', wrappedError);
      throw wrappedError;
    }
  }
}
