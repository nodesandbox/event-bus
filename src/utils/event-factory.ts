import { CloudEvent, EventMetadata } from '../types';
import { v4 as uuid } from 'uuid';

export class EventFactory {
  // NOTE: T, E extends string = string => E : that correspond to event type will be optional
  static create<T, E extends string /*= string*/>(
    type: E,
    data: T,
    source: string,
    options?: Partial<EventMetadata>
  ): CloudEvent<T, E> {
    const metadata: EventMetadata = {
      id: options?.id || uuid(),
      time: options?.time || new Date().toISOString(),
      source,
      specversion: options?.specversion || "1.0",
      datacontenttype: options?.datacontenttype || "application/json",
      subject: options?.subject,
      correlationId: options?.correlationId
    };

    return {
      metadata,
      type,
      data
    };
  }
}
