# RabbitMQ Event Bus

A powerful and flexible Event Bus built on top of RabbitMQ, enabling reliable event-driven communication between multiple Node.js services. This package supports advanced features such as message persistence, retries, dead-letter queues, and idempotency.

## Features

- **Reliable Event Publishing and Consumption**: Ensures message delivery with options for persistence and mandatory routing.
- **Flexible Subscription**: Supports multiple routing keys and handlers for a single queue.
- **Dead Letter Queue (DLQ) Support**: Captures failed messages for analysis or retries.
- **Retry Mechanism**: Automatically retries failed messages with configurable delays.
- **Idempotency Handling**: Avoids duplicate processing of the same message.
- **Dynamic Configuration**: Fully customizable message stores, retry logic, and connection options.

## Installation

```bash
npm install @nodesandbox/event-bus
```

## Usage

### Initialization

Create an instance of the `RabbitMQEventBus` with the necessary configuration.

```typescript
import { RabbitMQEventBus } from '@nodesandbox/event-bus';

const eventBus = new RabbitMQEventBus({
  connection: {
    url: 'amqp://localhost:5672',
    exchange: 'events',
    exchangeType: 'topic',
    deadLetterExchange: 'events.dlx',
    retryExchange: 'events.retry',
  },
  producer: {
    persistent: true,
    mandatory: true,
  },
  consumer: {
    prefetch: 10,
    autoAck: false,
  },
});

await eventBus.init();
console.log('RabbitMQ Event Bus initialized successfully.');
```

---

### Publishing Events

Publish events to RabbitMQ using the `publish` method. Events follow the [CloudEvents](https://cloudevents.io/) specification.

```typescript
const event = {
  type: 'order.created',
  data: { orderId: '1234', userId: 'user001' },
  metadata: {
    id: 'event-id-1234',
    source: 'order-service',
    time: new Date().toISOString(),
  },
};

await eventBus.publish(event);
console.log('Event published:', event);
```

---

### Subscribing to Events

Subscribe to events using the `subscribe` method and provide a handler function.

```typescript
await eventBus.subscribe(
  ['order.created', 'order.updated'],
  async (event) => {
    console.log('Received event:', event);
    // Handle event
  },
  { queue: 'order-queue' } // Optional custom queue name
);
```

---

### Unsubscribing

Unsubscribe a consumer using its consumer tag.

```typescript
await eventBus.unsubscribe('consumer-tag');
console.log('Unsubscribed successfully.');
```

---

### Closing the Event Bus

Gracefully close the Event Bus, including all active connections and channels.

```typescript
await eventBus.close();
console.log('RabbitMQ Event Bus closed.');
```

---

## Advanced Configuration

### Dead Letter Queue (DLQ)

Capture failed messages using DLQ:

```typescript
await eventBus.subscribe(
  ['events.dlx'],
  async (event) => {
    console.warn('Dead Letter Message:', event);
    // Handle DLQ message
  },
  { queue: 'dlq-queue' }
);
```

---

### Retry Mechanism

Customize retry delays and maximum attempts:

```typescript
const eventBus = new RabbitMQEventBus({
  connection: {
    url: 'amqp://localhost:5672',
    exchange: 'events',
  },
  producer: {
    persistent: true,
  },
  consumer: {
    prefetch: 10,
    autoAck: false,
  },
  retryOptions: {
    maxRetries: 5,
    retryDelays: [1000, 5000, 10000], // Retry after 1s, 5s, and 10s
  },
});
```

---

### Idempotency Handling

The `IdempotencyStore` ensures that duplicate messages are not processed:

```typescript
eventBus.useIdempotencyStore(new CustomIdempotencyStore());

class CustomIdempotencyStore {
  private processedMessages = new Map();

  async markAsProcessed(messageId, result) {
    this.processedMessages.set(messageId, { result });
  }

  async hasBeenProcessed(messageId) {
    return this.processedMessages.has(messageId);
  }
}
```

---

## API Reference

### `RabbitMQEventBus(options)`

| Option             | Description                                                                 | Default                |
|--------------------|-----------------------------------------------------------------------------|------------------------|
| `connection.url`   | The RabbitMQ connection URL.                                                | `amqp://localhost:5672` |
| `connection.exchange` | Name of the exchange.                                                     | `events`               |
| `connection.exchangeType` | Type of the exchange (`topic`, `direct`, `fanout`).                    | `topic`                |
| `producer.persistent` | Ensure messages are persistent.                                           | `true`                 |
| `producer.mandatory` | Return unroutable messages to the publisher.                              | `true`                 |
| `consumer.prefetch` | Number of messages to prefetch.                                            | `10`                   |
| `consumer.autoAck`  | Automatically acknowledge messages.                                        | `false`                |

---

### `publish(event, options?)`

Publishes an event to RabbitMQ.

- **event**: The CloudEvent to be published.
- **options**: Additional AMQP options (e.g., headers, expiration).

---

### `subscribe(eventTypes, handler, options?)`

Subscribes to one or more event types.

- **eventTypes**: An array of event types or a single event type.
- **handler**: A function to handle incoming events.
- **options.queue**: The name of the queue.

---

### `unsubscribe(consumerTag)`

Unsubscribes a consumer by its tag.

---

### `close()`

Closes the connection and all active channels.

---

## Best Practices

- **Use Persistent Messages**: Ensure critical messages are not lost by enabling persistence.
- **Implement DLQs**: Capture and analyze failed messages for debugging or retrying.
- **Use Idempotency**: Prevent duplicate processing of messages.
- **Monitor RabbitMQ**: Leverage RabbitMQ's monitoring tools to track queue states and message flow.


---

### Sample Project: A Practical Example

To see the package in action, we created a **sample project** simulating an e-commerce system with multiple microservices communicating via this Event Bus.

#### Overview of the Sample Project

- **Order Service**:
  - Publishes events related to order creation (`order.created`) and updates.
  - Interacts with Inventory and Payment Services to coordinate order processing.

- **Inventory Service**:
  - Subscribes to stock-related events like `stock.check` and `stock.reserved`.
  - Publishes responses (`stock.check.response`) and manages inventory updates.

- **Payment Service**:
  - Handles payment-related events such as `payment.initiated` and publishes results (`payment.succeeded` or `payment.failed`).

- **Notification Service**:
  - Subscribes to multiple events (`order.created`, `order.completed`, `payment.succeeded`, etc.) to send notifications.

Each service is a separate Node.js server using this package for communication. The project demonstrates reliable event flow, retries, and error handling.

#### How to Run the Sample Project

1. **Clone the sample project repository**:
   ```bash
   git clone https://github.com/nodesandbox/event-bus-sample.git
   cd event-bus-sample
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start RabbitMQ**:
   Ensure RabbitMQ is running, either locally or via Docker:
   ```bash
   docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:management
   ```

4. **Start the services**:
   Launch each service in a separate terminal:
   ```bash
   # Order Service
   cd order-service
   npm start

   # Inventory Service
   cd inventory-service
   npm start

   # Payment Service
   cd payment-service
   npm start

   # Notification Service
   cd notification-service
   npm start
   ```

5. **Test the system**:
   Use Postman, Curl, or any HTTP client to simulate creating an order:
   ```bash
   curl -X POST http://localhost:3001/orders \
   -H "Content-Type: application/json" \
   -d '{
       "userId": "user123",
       "items": [
           { "productId": "PROD1", "quantity": 2, "price": 19.99 },
           { "productId": "PROD2", "quantity": 1, "price": 9.99 }
       ]
   }'
   ```

   Check the logs of all services to observe event publication and handling.

6. **Monitor with RabbitMQ Management UI**:
   Access the RabbitMQ management interface at [http://localhost:15672/](http://localhost:15672/). Use `guest/guest` as login credentials to view exchanges, queues, and messages.

#### Repository

Find the full source code for the sample project here:

[https://github.com/nodesandbox/event-bus-sample](https://github.com/nodesandbox/event-bus-sample)

---

## Contributing

We welcome contributions! Please follow these steps:
1. Fork the repository.
2. Create a new branch.
3. Submit a pull request with your changes.

---

## License

This package is licensed under the MIT License. See [LICENSE](./LICENSE) for more details.