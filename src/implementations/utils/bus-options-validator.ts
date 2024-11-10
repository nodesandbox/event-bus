import { DEFAULT_OPTIONS, EventBusOptions, ValidatedEventBusOptions } from "../../interfaces";

export function validateAndMergeOptions(options: EventBusOptions): ValidatedEventBusOptions {
    if (!options.connection?.url) {
      throw new Error('Connection URL is required');
    }
  
    return {
      connection: {
        ...DEFAULT_OPTIONS.connection,
        ...options.connection,
        url: options.connection.url,
      },
      consumer: {
        ...DEFAULT_OPTIONS.consumer,
        ...options.consumer,
      },
      producer: {
        ...DEFAULT_OPTIONS.producer,
        ...options.producer,
      },
    } as ValidatedEventBusOptions;
  }