// import { Channel, Connection, connect, ConsumeMessage } from 'amqplib';
// import { v4 as uuid } from 'uuid';
// import { EventBus, EventBusOptions, PublishOptions, SubscribeOptions } from '../../interfaces';
// import { CloudEvent, EventType } from '../../types';

// // Custom Error Classes
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

// // Enhanced Dead Letter Interface
// interface DeadLetterDetails {
//   messageId: string;
//   failureReason: string;
//   retryCount: number;
//   timestamp: string;
//   originalExchange: string;
//   originalRoutingKey: string;
//   content: string;
//   headers: Record<string, any>;
//   error?: Error;
// }

// export class RabbitMQEventBus implements EventBus {
//   private connection?: Connection;
//   private channel?: Channel;
//   private readonly options: Required<EventBusOptions>;
//   private isInitialized = false;
//   private reconnectAttempts = 0;

//   // Constants
//   private readonly MAX_RETRIES = 3;
//   private readonly RETRY_DELAYS = [1000, 5000, 15000]; // Progressive delays in ms
//   private readonly RECONNECT_DELAY = 5000; // 5 seconds
//   private readonly MAX_RECONNECT_ATTEMPTS = 10;
//   private readonly DLQ_RETENTION = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
//   private readonly QUEUE_MAX_LENGTH = 10000;

//   constructor(options: EventBusOptions) {
//     this.options = {
//       connection: {
//         exchange: 'events',
//         exchangeType: 'topic',
//         deadLetterExchange: 'events.dlx',
//         retryExchange: 'events.retry',
//         ...options.connection,
//       },
//       consumer: {
//         prefetch: 1,
//         autoAck: false,
//         ...options.consumer,
//       },
//       producer: {
//         persistent: true,
//         mandatory: true,
//         ...options.producer,
//       },
//     };
//   }

//   private validateState(): void {
//     if (!this.isInitialized) {
//       throw new Error('EventBus not initialized. Call init() first.');
//     }
//     if (!this.connection || !this.channel) {
//       throw new Error('Connection or channel not available.');
//     }
//   }

//   async init(): Promise<void> {
//     try {
//       await this.connect();
//       await this.setupExchangesAndQueues();
//       this.setupEventHandlers();
//       this.isInitialized = true;
//       console.log('RabbitMQ EventBus initialized successfully');
//     } catch (error) {
//       const wrappedError = new MessageProcessingError(
//         'Failed to initialize RabbitMQ EventBus',
//         error as Error
//       );
//       console.error('Initialization error:', wrappedError);
//       throw wrappedError;
//     }
//   }

//   private async connect(): Promise<void> {
//     try {
//       this.connection = await connect(this.options.connection.url);
//       this.channel = await this.connection.createChannel();
//       this.reconnectAttempts = 0;
//       console.log('Connected to RabbitMQ successfully');
//     } catch (error) {
//       this.reconnectAttempts++;
//       if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
//         console.warn(`Connection attempt ${this.reconnectAttempts} failed, retrying in ${this.RECONNECT_DELAY}ms`);
//         await new Promise(resolve => setTimeout(resolve, this.RECONNECT_DELAY));
//         return this.connect();
//       }
//       throw error;
//     }
//   }

//   private async setupExchangesAndQueues(): Promise<void> {
//     if (!this.channel) throw new Error('Channel not initialized');

//     // Setup main exchange
//     await this.channel.assertExchange(
//       this.options.connection.exchange!,
//       this.options.connection.exchangeType!,
//       { durable: true }
//     );

//     // Setup retry exchange
//     await this.channel.assertExchange(
//       this.options.connection.retryExchange!,
//       'direct',
//       { durable: true }
//     );

//     // Setup dead letter exchange
//     await this.channel.assertExchange(
//       this.options.connection.deadLetterExchange!,
//       'topic',
//       { durable: true }
//     );

//     // Setup dead letter queue
//     const dlqName = `${this.options.connection.exchange}.dlq`;
//     await this.channel.assertQueue(dlqName, {
//       durable: true,
//       arguments: {
//         'x-message-ttl': this.DLQ_RETENTION,
//         'x-max-length': this.QUEUE_MAX_LENGTH,
//         'x-overflow': 'reject-publish'
//       }
//     });

//     await this.channel.bindQueue(
//       dlqName,
//       this.options.connection.deadLetterExchange!,
//       '#'
//     );

//     await this.setupDeadLetterConsumer(dlqName);
//   }

//   private setupEventHandlers(): void {
//     if (!this.connection || !this.channel) return;

//     // Connection event handlers
//     this.connection.on('error', this.handleConnectionError.bind(this));
//     this.connection.on('close', this.handleConnectionClosed.bind(this));

//     // Channel event handlers
//     this.channel.on('error', this.handleChannelError.bind(this));
//     this.channel.on('close', this.handleChannelClosed.bind(this));
//     this.channel.on('return', this.handleUnroutableMessage.bind(this));
//   }

//   private async handleConnectionError(error: Error): Promise<void> {
//     console.error('Connection error:', error);
//     await this.reconnect();
//   }

//   private async handleConnectionClosed(): Promise<void> {
//     console.warn('Connection closed, attempting to reconnect...');
//     await this.reconnect();
//   }

//   private async handleChannelError(error: Error): Promise<void> {
//     console.error('Channel error:', error);
//     await this.recreateChannel();
//   }

//   private async handleChannelClosed(): Promise<void> {
//     console.warn('Channel closed, attempting to recreate...');
//     await this.recreateChannel();
//   }

//   private async reconnect(): Promise<void> {
//     this.isInitialized = false;
//     try {
//       await this.init();
//     } catch (error) {
//       console.error('Failed to reconnect:', error);
//       setTimeout(() => this.reconnect(), this.RECONNECT_DELAY);
//     }
//   }

//   private async recreateChannel(): Promise<void> {
//     try {
//       if (!this.connection) throw new Error('No connection available');
//       this.channel = await this.connection.createChannel();
//       await this.setupExchangesAndQueues();
//       console.log('Channel recreated successfully');
//     } catch (error) {
//       console.error('Failed to recreate channel:', error);
//       await this.reconnect();
//     }
//   }

//   private async setupDeadLetterConsumer(dlqName: string): Promise<void> {
//     if (!this.channel) return;

//     await this.channel.consume(
//       dlqName,
//       async (msg) => {
//         if (!msg) return;

//         try {
//           const details = this.extractDeadLetterDetails(msg);
//           await this.handleDeadLetter(details);
//           await this.channel?.ack(msg);
//         } catch (error) {
//           console.error('Error processing dead letter:', error);
//           await this.channel?.reject(msg, false);
//         }
//       },
//       { noAck: false }
//     );
//   }

//   private extractDeadLetterDetails(msg: ConsumeMessage): DeadLetterDetails {
//     const headers = msg.properties.headers || {};
//     const deathInfo = headers['x-death']?.[0] || {};

//     return {
//       messageId: msg.properties.messageId || 'unknown',
//       failureReason: headers['x-failure-reason'] || 'Unknown failure',
//       retryCount: headers['x-retry-count'] || 0,
//       timestamp: new Date().toISOString(),
//       originalExchange: deathInfo.exchange || '',
//       originalRoutingKey: deathInfo.routingKey || '',
//       content: msg.content.toString(),
//       headers: headers,
//       error: headers['x-error-message'] ? new Error(headers['x-error-message']) : undefined
//     };
//   }

//   private async handleDeadLetter(details: DeadLetterDetails): Promise<void> {
//     console.error('Dead Letter Processing:', {
//       messageId: details.messageId,
//       failureReason: details.failureReason,
//       retryCount: details.retryCount,
//       timestamp: details.timestamp    });

//       if (this.shouldAttemptRecovery(details)) {
//         try {
//           await this.attemptMessageRecovery(details);
//           console.log(`Recovery attempt successful for message ${details.messageId}`);
//         } catch (error) {
//           console.error(`Recovery attempt failed for message ${details.messageId}:`, error);
//           await this.notifyDeadLetter(details);
//           this.incrementDeadLetterMetrics(details);
//         }
//       } else {
//         await this.notifyDeadLetter(details);
//         this.incrementDeadLetterMetrics(details);
//       }
//     }
  
//     private shouldAttemptRecovery(details: DeadLetterDetails): boolean {
//       const recoverableErrors = ['ConnectionError', 'TimeoutError'];
//       return (
//         recoverableErrors.includes(details.error?.name || '') &&
//         details.retryCount < this.MAX_RETRIES
//       );
//     }
  
//     private async attemptMessageRecovery(details: DeadLetterDetails): Promise<void> {
//       if (!this.channel) throw new Error('Channel not initialized');
  
//       const headers = {
//         ...details.headers,
//         'x-retry-count': details.retryCount + 1,
//         'x-recovery-attempt': true,
//         'x-original-error': details.error?.message,
//       };
  
//       try {
//         const published = await this.channel.publish(
//           this.options.connection.retryExchange!,
//           details.originalRoutingKey,
//           Buffer.from(details.content),
//           { headers }
//         );
  
//         if (!published) {
//           throw new Error('Failed to publish retry message');
//         }
//       } catch (error) {
//         console.error('Failed to publish to retry exchange:', error);
//         throw error;
//       }
//     }
  
//     private async notifyDeadLetter(details: DeadLetterDetails): Promise<void> {
//       // Implement notification logic, e.g., sending an email or logging to an alerting service
//       console.log('Dead Letter Notification:', {
//         messageId: details.messageId,
//         failureReason: details.failureReason,
//         retryCount: details.retryCount,
//         timestamp: details.timestamp,
//       });
//     }
  
//     private incrementDeadLetterMetrics(details: DeadLetterDetails): void {
//       // Implement metrics tracking logic, e.g., updating Prometheus or other monitoring tools
//       console.log('Dead Letter Metrics updated for:', {
//         routingKey: details.originalRoutingKey,
//         exchange: details.originalExchange,
//         failureReason: details.failureReason,
//         retryCount: details.retryCount,
//       });
//     }
// }  
