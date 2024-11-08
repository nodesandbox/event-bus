import { CloudEvent } from "../types";
import { PublishOptions, SubscribeOptions } from "./io-options";

export interface EventBusOptions {
  connection: {
    url: string;
    exchange?: string;
    exchangeType?: 'topic' | 'direct' | 'fanout';
    deadLetterExchange?: string;
    retryExchange?: string;
  };
  consumer?: {
    prefetch?: number;
    autoAck?: boolean;
  };
  producer?: {
    persistent?: boolean;
    mandatory?: boolean;
  };
}

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