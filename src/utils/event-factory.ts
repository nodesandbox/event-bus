import { CloudEvent, EventMetadata } from '../types';
import { EventType } from '../types/event-type';
import { v4 as uuid } from 'uuid';

export class EventFactory {
    static create<T>(
      type: EventType,
      data: T,
      source: string,
      options?: Partial<EventMetadata>
    ): CloudEvent<T> {
      const metadata: EventMetadata = {
        id: options?.id || uuid(),
        time: options?.time || new Date().toISOString(),
        source,
        specversion: options?.specversion || '1.0',
        datacontenttype: options?.datacontenttype || 'application/json',
        subject: options?.subject
      };
  
      return {
        metadata,
        type,
        data
      };
    }
  }