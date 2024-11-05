import { CloudEvent, EventType } from "../types";
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

export interface EventBus {
  publish<T>(event: CloudEvent<T>, options?: PublishOptions): Promise<void>;
  subscribe<T>(
    type: EventType | EventType[],
    handler: (event: CloudEvent<T>) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<void>;
  unsubscribe(consumerTag: string): Promise<void>;
  close(): Promise<void>;
}