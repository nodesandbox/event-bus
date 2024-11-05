// import { Channel, Connection, connect, ConsumeMessage } from 'amqplib';
// import { v4 as uuid } from 'uuid';
// import { EventBus, EventBusOptions, PublishOptions, SubscribeOptions } from '../../interfaces';
// import { CloudEvent, EventType } from '../../types';

// // Types d'erreurs personnalisés pour une meilleure gestion
// class MessageProcessingError extends Error {
//   constructor(message: string, public readonly originalError: Error) {
//     super(message);
//     this.name = 'MessageProcessingError';
//   }
// }

// class RetryableError extends Error {
//   constructor(message: string) {
//     super(message);
//     this.name = 'RetryableError';
//   }
// }

// export class RabbitMQEventBus implements EventBus {
//   private connection?: Connection;
//   private channel?: Channel;
//   private readonly options: Required<EventBusOptions>;
//   private readonly MAX_RETRIES = 3;
//   private readonly RETRY_DELAYS = [1000, 5000, 15000]; // Délais progressifs en ms

//   constructor(options: EventBusOptions) {
//     this.options = {
//       connection: {
//         exchange: 'events',
//         exchangeType: 'topic',
//         deadLetterExchange: 'events.dlx',
//         ...options.connection
//       },
//       consumer: {
//         prefetch: 1,
//         autoAck: false,
//         ...options.consumer
//       },
//       producer: {
//         persistent: true,
//         mandatory: true,
//         ...options.producer
//       }
//     };
//   }

//   async init(): Promise<void> {
//     try {
//       this.connection = await connect(this.options.connection.url);
//       this.channel = await this.connection.createChannel();

//       // Setup exchanges
//       await this.channel.assertExchange(
//         this.options.connection.exchange as string,
//         this.options.connection.exchangeType as string,
//         { durable: true }
//       );

//       await this.channel.assertExchange(
//         this.options.connection.deadLetterExchange as string,
//         'topic',
//         { durable: true }
//       );

//       // Setup error handling with reconnection logic
//       this.connection.on('error', this.handleConnectionError.bind(this));
//       this.connection.on('close', this.handleConnectionClosed.bind(this));
//       this.channel.on('error', this.handleChannelError.bind(this));
//       this.channel.on('close', this.handleChannelClosed.bind(this));

//     } catch (error) {
//       console.error('Failed to initialize RabbitMQ connection:', error);
//       throw error;
//     }
//   }

//   async publish<T>(
//     event: CloudEvent<T>,
//     options?: PublishOptions
//   ): Promise<void> {
//     if (!this.channel) {
//       throw new Error('Channel not initialized');
//     }

//     const content = Buffer.from(JSON.stringify(event));
//     const timestamp = Date.now();
    
//     try {
//       await this.channel.publish(
//         this.options.connection.exchange as string,
//         event.type,
//         content,
//         {
//           persistent: this.options.producer.persistent,
//           mandatory: this.options.producer.mandatory,
//           priority: options?.priority,
//           expiration: options?.expiration,
//           timestamp,
//           headers: {
//             ...options?.headers,
//             'x-event-id': event.metadata.id,
//             'x-published-timestamp': timestamp
//           }
//         }
//       );
//     } catch (error) {
//       console.error(`Failed to publish event ${event.metadata.id}:`, error);
//       throw error;
//     }
//   }

//   private async handleMessage<T>(
//     msg: ConsumeMessage,
//     handler: (event: CloudEvent<T>) => Promise<void>
//   ): Promise<void> {
//     if (!this.channel) {
//       throw new Error('Channel not initialized');
//     }

//     const retryCount = (msg.properties.headers?.['x-retry-count'] as number) || 0;
//     const messageId = msg.properties.headers?.['x-event-id'] || 'unknown';
//     const startTime = Date.now();

//     try {
//       const event = JSON.parse(msg.content.toString()) as CloudEvent<T>;
      
//       console.log(`[${messageId}] Processing message (attempt ${retryCount + 1}/${this.MAX_RETRIES + 1})`);
      
//       await handler(event);
      
//       const processTime = Date.now() - startTime;
//       console.log(`[${messageId}] Successfully processed message in ${processTime}ms`);
      
//       await this.channel.ack(msg);

//     } catch (error) {
//       const processTime = Date.now() - startTime;
//       console.error(`[${messageId}] Failed to process message after ${processTime}ms:`, error);

//       if (retryCount < this.MAX_RETRIES) {
//         const nextRetryDelay = this.RETRY_DELAYS[retryCount];
//         const updatedHeaders = {
//           ...msg.properties.headers,
//           'x-retry-count': retryCount + 1,
//           'x-last-retry-timestamp': Date.now(),
//           'x-next-retry-delay': nextRetryDelay
//         };

//         // Republier avec un délai avant la prochaine tentative
//         setTimeout(() => {
//           try {
//             this.channel?.nack(msg, false, false);
//             console.log(`[${messageId}] Message requeued for attempt ${retryCount + 2}/${this.MAX_RETRIES + 1} after ${nextRetryDelay}ms`);
//           } catch (nackError) {
//             console.error(`[${messageId}] Failed to requeue message:`, nackError);
//             // En cas d'échec du nack, on rejette définitivement
//             this.channel?.reject(msg, false);
//           }
//         }, nextRetryDelay);

//       } else {
//         console.log(`[${messageId}] Message rejected after ${this.MAX_RETRIES} failed attempts`);
//         await this.channel.reject(msg, false);
//       }
//     }
//   }

//   async subscribe<T>(
//     type: EventType | EventType[],
//     handler: (event: CloudEvent<T>) => Promise<void>,
//     options?: SubscribeOptions
//   ): Promise<void> {
//     if (!this.channel) {
//       throw new Error('Channel not initialized');
//     }

//     const types = Array.isArray(type) ? type : [type];
//     const queueName = options?.queue || uuid();

//     try {
//       // Assert queue with dead-letter configuration and TTL
//       const { queue } = await this.channel.assertQueue(queueName, {
//         exclusive: options?.exclusive ?? !options?.queue,
//         durable: true,
//         arguments: {
//           'x-dead-letter-exchange': this.options.connection.deadLetterExchange,
//           'x-message-ttl': 24 * 60 * 60 * 1000, // 24 heures en ms
//           'x-max-length': 10000, // Limite de la taille de la queue
//           'x-overflow': 'reject-publish' // Rejeter les nouveaux messages si la queue est pleine
//         }
//       });

//       // Bind queue to all specified event types
//       for (const eventType of types) {
//         await this.channel.bindQueue(
//           queue,
//           this.options.connection.exchange as string,
//           eventType
//         );
//         console.log(`Bound queue ${queue} to event type ${eventType}`);
//       }

//       // Set prefetch
//       await this.channel.prefetch(this.options.consumer.prefetch as number);

//       // Start consuming
//       await this.channel.consume(
//         queue,
//         async (msg) => {
//           if (msg) {
//             await this.handleMessage(msg, handler);
//           }
//         },
//         {
//           consumerTag: options?.consumerTag,
//           noAck: false
//         }
//       );

//       console.log(`Started consuming from queue ${queue} for event types: ${types.join(', ')}`);

//     } catch (error) {
//       console.error('Failed to setup subscription:', error);
//       throw error;
//     }
//   }

//   private async reconnect(): Promise<void> {
//     try {
//       await this.close();
//       await this.init();
//       console.log('Successfully reconnected to RabbitMQ');
//     } catch (error) {
//       console.error('Failed to reconnect:', error);
//       // Réessayer après un délai
//       setTimeout(() => this.reconnect(), 5000);
//     }
//   }

//   private handleConnectionError(error: Error): void {
//     console.error('RabbitMQ Connection Error:', error);
//     this.reconnect();
//   }

//   private handleConnectionClosed(): void {
//     console.log('RabbitMQ Connection closed, attempting to reconnect...');
//     this.reconnect();
//   }

//   private handleChannelError(error: Error): void {
//     console.error('RabbitMQ Channel Error:', error);
//     // La reconnexion sera gérée au niveau de la connexion
//   }

//   private handleChannelClosed(): void {
//     console.log('RabbitMQ Channel closed');
//     // La reconnexion sera gérée au niveau de la connexion
//   }

//   async unsubscribe(consumerTag: string): Promise<void> {
//     if (!this.channel) {
//       throw new Error('Channel not initialized');
//     }

//     try {
//       await this.channel.cancel(consumerTag);
//       console.log(`Unsubscribed consumer ${consumerTag}`);
//     } catch (error) {
//       console.error(`Failed to unsubscribe consumer ${consumerTag}:`, error);
//       throw error;
//     }
//   }

//   async close(): Promise<void> {
//     try {
//       await this.channel?.close();
//       await this.connection?.close();
//       console.log('Closed RabbitMQ connection and channel');
//     } catch (error) {
//       console.error('Error while closing RabbitMQ connection:', error);
//       throw error;
//     }
//   }
// }