import { Channel, Connection, connect } from 'amqplib';
import { v4 as uuid } from 'uuid';
import { EventBus, EventBusOptions, PublishOptions, SubscribeOptions } from '../../interfaces';
import { CloudEvent, EventType } from '../../types';

export class RabbitMQEventBus implements EventBus {
  private connection?: Connection;
  private channel?: Channel;
  private readonly options: Required<EventBusOptions>;

  constructor(options: EventBusOptions) {
    this.options = {
      connection: {
        exchange: 'events',
        exchangeType: 'topic',
        deadLetterExchange: 'events.dlx',
        ...options.connection
      },
      consumer: {
        prefetch: 1,
        autoAck: false,
        ...options.consumer
      },
      producer: {
        persistent: true,
        mandatory: true,
        ...options.producer
      }
    };
  }

  async init(): Promise<void> {
    this.connection = await connect(this.options.connection.url);
    this.channel = await this.connection.createChannel();

    // Setup exchanges
    await this.channel.assertExchange(
      this.options.connection.exchange as string,
      this.options.connection.exchangeType as string,
      { durable: true }
    );

    await this.channel.assertExchange(
      this.options.connection.deadLetterExchange as string,
      'topic',
      { durable: true }
    );

    // Setup error handling
    this.connection.on('error', this.handleConnectionError.bind(this));
    this.channel.on('error', this.handleChannelError.bind(this));
  }

  async publish<T>(
    event: CloudEvent<T>,
    options?: PublishOptions
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const content = Buffer.from(JSON.stringify(event));
    
    await this.channel.publish(
      this.options.connection.exchange as string,
      event.type, // Le type est maintenant un champ direct de l'événement
      content,
      {
        persistent: this.options.producer.persistent,
        mandatory: this.options.producer.mandatory,
        priority: options?.priority,
        expiration: options?.expiration,
        headers: {
          ...options?.headers,
          'x-event-id': event.metadata.id // L'ID est maintenant dans les métadonnées
        }
      }
    );
  }

  async subscribe<T>(
    type: EventType | EventType[],
    handler: (event: CloudEvent<T>) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const types = Array.isArray(type) ? type : [type];
    const queueName = options?.queue || uuid();

    // Assert queue with dead-letter configuration
    const { queue } = await this.channel.assertQueue(queueName, {
      exclusive: options?.exclusive ?? !options?.queue,
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.options.connection.deadLetterExchange
      }
    });

    // Bind queue to all specified event types
    for (const eventType of types) {
      await this.channel.bindQueue(
        queue,
        this.options.connection.exchange as string,
        eventType
      );
    }

    // Set prefetch
    await this.channel.prefetch(this.options.consumer.prefetch as number);

    // Start consuming
    await this.channel.consume(
      queue,
      async (msg) => {
        if (!msg) return;

        try {
          const event = JSON.parse(msg.content.toString()) as CloudEvent<T>;
          await handler(event);
          this.channel?.ack(msg);
        } catch (error) {
          // Implement retry logic with dead-letter
          const headers = msg.properties?.headers ?? {};
          const retryCount = (headers['x-retry-count'] as number) || 0;
          
          if (retryCount <= 3) {
            // Mettre à jour le compteur de tentatives dans les en-têtes
            const updatedHeaders = {
              ...headers,
              'x-retry-count': retryCount + 1,
              'x-original-event-id': headers['x-original-event-id'] || headers['x-event-id']
            };

            // Republier avec les en-têtes mis à jour
            this.channel?.nack(msg, false, false);
          } else {
            // Rejeter définitivement après 3 tentatives
            this.channel?.reject(msg, false);
          }
        }
      },
      {
        consumerTag: options?.consumerTag,
        noAck: options?.noAck ?? !this.options.consumer.autoAck
      }
    );
  }

  async unsubscribe(consumerTag: string): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    await this.channel.cancel(consumerTag);
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private handleConnectionError(error: Error): void {
    console.error('RabbitMQ Connection Error:', error);
    // Implement reconnection logic here if needed
  }

  private handleChannelError(error: Error): void {
    console.error('RabbitMQ Channel Error:', error);
    // Implement channel recovery logic here if needed
  }
}