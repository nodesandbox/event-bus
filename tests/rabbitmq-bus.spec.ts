import { Connection, Channel, ConsumeMessage } from 'amqplib';
import { CloudEvent } from '../src/types';
import { v4 as uuid } from 'uuid';
import { EventBusOptions, RabbitMQEventBus } from '../src';
import { MessageProcessingError, RetryableError } from '../src/implementations/rabbitmq/errors';

function getEventHandler(mockObj: any, eventName: string): (...args: any[]) => Promise<void> {
  const handler = mockObj.on.mock.calls.find((call: any) => call[0] === eventName)?.[1];
  if (!handler) {
    throw new Error(`Handler for event "${eventName}" not found.`);
  }
  return handler;
}

jest.mock('amqplib', () => ({
  connect: jest.fn(),
}));

describe('RabbitMQEventBus', () => {
  let eventBus: RabbitMQEventBus;
  let mockConnection: jest.Mocked<Connection>;
  let mockChannel: jest.Mocked<Channel>;
  
  const defaultOptions: EventBusOptions = {
    connection: {
      url: 'amqp://localhost',
      exchange: 'test-exchange',
      exchangeType: 'topic',
      deadLetterExchange: 'test-dlx',
      retryExchange: 'test-retry'
    }
  };

  beforeEach(() => {
    // Setup mock channel
    mockChannel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue({ queue: 'test-queue' }),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(true),
      consume: jest.fn().mockImplementation((queue, callback) => {
        return Promise.resolve({ consumerTag: 'test-consumer' });
      }),
      prefetch: jest.fn().mockResolvedValue(undefined),
      ack: jest.fn().mockResolvedValue(undefined),
      nack: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    } as unknown as jest.Mocked<Channel>;

    // Setup mock connection
    mockConnection = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    } as unknown as jest.Mocked<Connection>;

    (require('amqplib').connect as jest.Mock).mockResolvedValue(mockConnection);

    eventBus = new RabbitMQEventBus(defaultOptions);
  });

  afterEach(async() => {
    jest.clearAllMocks();
    if (eventBus) {
      await eventBus.close();
  }
  });
  

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      await eventBus.init();
      
      expect(require('amqplib').connect).toHaveBeenCalledWith(defaultOptions.connection.url);
      expect(mockConnection.createChannel).toHaveBeenCalled();
      expect(mockChannel.assertExchange).toHaveBeenCalledWith(
        defaultOptions.connection.exchange,
        defaultOptions.connection.exchangeType,
        expect.any(Object)
      );
    });

    test('should handle initialization failure', async () => {
      eventBus.setDisableReconnection(true); // Désactive la reconnexion pour le test
      const error = new Error('Connection failed');
      (require('amqplib').connect as jest.Mock).mockRejectedValueOnce(error);
  
      await expect(eventBus.init()).rejects.toThrow('Connection failed');
  });

    test('should setup error handlers during initialization', async () => {
      await eventBus.init();

      expect(mockConnection.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockConnection.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockChannel.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockChannel.on).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('Publishing', () => {
    const testEvent: CloudEvent<any, string> = {
      type: 'test.event',
      data: { message: 'test' },
      metadata: {
        specversion: '1.0',
        id: uuid(),
        time: new Date().toISOString(),
        source: 'test-source',
      },
    };

    beforeEach(async () => {
      await eventBus.init();
    });

    test('should publish message successfully', async () => {
      await eventBus.publish(testEvent);

      expect(mockChannel.publish).toHaveBeenCalledWith(
        defaultOptions.connection.exchange,
        testEvent.type,
        expect.any(Buffer),
        expect.objectContaining({
          messageId: expect.any(String),
          timestamp: expect.any(Number),
        })
      );
    });

    test('should handle publish failure', async () => {
      mockChannel.publish.mockReturnValueOnce(false);
      await expect(eventBus.publish(testEvent)).rejects.toThrow(MessageProcessingError);
    });

    test('should publish with custom options', async () => {
      const customOptions = {
        persistent: true,
        headers: { 'custom-header': 'value' }
      };

      await eventBus.publish(testEvent, customOptions);

      expect(mockChannel.publish).toHaveBeenCalledWith(
        defaultOptions.connection.exchange,
        testEvent.type,
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          headers: expect.objectContaining({
            'custom-header': 'value'
          })
        })
      );
    });
  });

  describe('Subscribing', () => {
    const handler = jest.fn();

    beforeEach(async () => {
      await eventBus.init();
    });

    test('should subscribe to event successfully', async () => {
      await eventBus.subscribe('test.event', handler);

      expect(mockChannel.assertQueue).toHaveBeenCalled();
      expect(mockChannel.bindQueue).toHaveBeenCalled();
      expect(mockChannel.consume).toHaveBeenCalled();
    });

    test('should handle multiple event types', async () => {
      await eventBus.subscribe(['test.event1', 'test.event2'], handler);
    
      const eventBindings = mockChannel.bindQueue.mock.calls.filter(
        call => call[2] === 'test.event1' || call[2] === 'test.event2'
      );
    
      expect(eventBindings).toHaveLength(2);
    });
    
    test('should handle message processing', async () => {
      const testMessage = {
        content: Buffer.from(JSON.stringify({ test: 'data' })),
        properties: {
          messageId: 'test-id',
          headers: {}
        },
        fields: {
          routingKey: 'test.event',
          exchange: 'test-exchange'
        }
      } as ConsumeMessage;

      // Simulate message consumption
      await eventBus.subscribe('test.event', handler);
      const consumeCallback = (mockChannel.consume as jest.Mock).mock.calls[0][1];
      await consumeCallback(testMessage);

      expect(handler).toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalledWith(testMessage);
    });

    test('should handle retryable errors', async () => {
      const handler = jest.fn().mockRejectedValueOnce(new RetryableError('Retry me'));
      
      await eventBus.subscribe('test.event', handler);

      const testMessage = {
        content: Buffer.from(JSON.stringify({ test: 'data' })),
        properties: {
          messageId: 'test-id',
          headers: {}
        },
        fields: {
          routingKey: 'test.event',
          exchange: 'test-exchange'
        }
      } as ConsumeMessage;

      const consumeCallback = (mockChannel.consume as jest.Mock).mock.calls[0][1];
      await consumeCallback(testMessage);

      expect(mockChannel.publish).toHaveBeenCalledWith(
        defaultOptions.connection.retryExchange,
        'test.event',
        expect.any(Buffer),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-retry-count': 1
          })
        })
      );
    });
  });

  describe('Dead Letter Handling', () => {
    test('should setup dead letter queue', async () => {
      await eventBus.init();

      expect(mockChannel.assertExchange).toHaveBeenCalledWith(
        defaultOptions.connection.deadLetterExchange,
        'topic',
        expect.any(Object)
      );
      expect(mockChannel.assertQueue).toHaveBeenCalledWith(
        expect.stringContaining('dlq'),
        expect.any(Object)
      );
    });

    test('should handle non-retryable errors', async () => {
      const handler = jest.fn().mockRejectedValueOnce(new Error('Fatal error'));
      
      await eventBus.init();
      await eventBus.subscribe('test.event', handler);

      const testMessage = {
        content: Buffer.from(JSON.stringify({ test: 'data' })),
        properties: {
          messageId: 'test-id',
          headers: {}
        },
        fields: {
          routingKey: 'test.event',
          exchange: 'test-exchange'
        }
      } as ConsumeMessage;

      const consumeCallback = (mockChannel.consume as jest.Mock).mock.calls[0][1];
      await consumeCallback(testMessage);

      expect(mockChannel.publish).toHaveBeenCalledWith(
        defaultOptions.connection.deadLetterExchange,
        'dead.letter',
        expect.any(Buffer),
        expect.any(Object)
      );
    });
  });

  describe('Connection Management', () => {
    test('should handle reconnection on connection loss', async () => {
      await eventBus.init();

      // Simulate connection loss
      const connectionError = new Error('Connection lost');
      const errorHandler = getEventHandler(mockConnection, 'error');
      await errorHandler(connectionError);

      expect(require('amqplib').connect).toHaveBeenCalledTimes(2);
    });

    test('should handle channel recreation', async () => {
      await eventBus.init();

      // Simulate channel error
      const channelError = new Error('Channel error');
      const errorHandler = getEventHandler(mockChannel, 'error');
      await errorHandler(channelError);

      expect(mockConnection.createChannel).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cleanup', () => {
    test('should close connection properly', async () => {
      await eventBus.init();
      await eventBus.close();

      expect(mockChannel.close).toHaveBeenCalled();
      expect(mockConnection.close).toHaveBeenCalled();
    });

    test('should handle close errors', async () => {
      mockChannel.close.mockRejectedValueOnce(new Error('Close failed'));
      
      await eventBus.init();
      await expect(eventBus.close()).rejects.toThrow(MessageProcessingError);
    });
  });

  describe('Message Store', () => {
    test('should store unroutable messages', async () => {
      await eventBus.init();

      // Simulate unroutable message
      const unroutableMessage = {
        content: Buffer.from('test'),
        properties: { messageId: 'test-id' },
        fields: {
          exchange: 'test-exchange',
          routingKey: 'unknown.route'
        }
      } as ConsumeMessage;

      const returnHandler = getEventHandler(mockChannel, 'return');
      returnHandler(unroutableMessage);

      // Vérifier que le message a été stocké (il faudrait exposer une méthode pour vérifier)
      // Cette vérification dépendra de votre implémentation spécifique
    });
  });

  describe('Idempotency', () => {
    test('should handle duplicate messages', async () => {
      const handler = jest.fn();
      const messageId = 'duplicate-id';
      
      await eventBus.init();
      await eventBus.subscribe('test.event', handler);

      const testMessage = {
        content: Buffer.from(JSON.stringify({ test: 'data' })),
        properties: {
          messageId,
          headers: {}
        },
        fields: {
          routingKey: 'test.event',
          exchange: 'test-exchange'
        }
      } as ConsumeMessage;

      const consumeCallback = (mockChannel.consume as jest.Mock).mock.calls[0][1];
      
      // Premier traitement
      await consumeCallback(testMessage);
      // Deuxième traitement du même message
      await consumeCallback(testMessage);

      // Le handler ne devrait être appelé qu'une seule fois
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});