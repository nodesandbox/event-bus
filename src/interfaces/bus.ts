import { CloudEvent } from "../types";
import { PublishOptions, SubscribeOptions } from "./io-options";

interface ConnectionOptions {
  url: string;  
  exchange: string;  
  exchangeType: 'topic' | 'direct' | 'fanout';  
  deadLetterExchange: string;
  retryExchange: string;
}

interface ConsumerOptions {
  prefetch?: number;  
  autoAck: boolean;
}

interface ProducerOptions {
  persistent: boolean;  
  mandatory: boolean;
}

export interface EventBusOptions {
  connection: ConnectionOptions;
  consumer?: Partial<ConsumerOptions>;
  producer?: Partial<ProducerOptions>;
}

export const DEFAULT_OPTIONS: Omit<Required<EventBusOptions>, 'connection'> & { connection: Omit<ConnectionOptions, 'url'> } = {
  connection: {
    exchange: 'events',
    exchangeType: 'topic',
    deadLetterExchange: 'events.dlx',
    retryExchange: 'events.retry'
  },
  consumer: {
    prefetch: 1,
    autoAck: false
  },
  producer: {
    persistent: true,
    mandatory: true  
  }
};

export type ValidatedEventBusOptions = Required<EventBusOptions> & {
  connection: Required<ConnectionOptions>;
  consumer: Required<ConsumerOptions>;
  producer: Required<ProducerOptions>;
};

export interface EventBus<E extends string = string> {
  publish<T>(event: CloudEvent<T, E>, options?: PublishOptions): Promise<void>;
  subscribe<T>(
    type: E | E[],
    handler: (event: CloudEvent<T, E>) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<void>;
  unsubscribe(consumerTag: string): Promise<void>;
  close(): Promise<void>;
}