export interface PublishOptions {
    priority?: number;
    expiration?: string;
    headers?: Record<string, unknown>;
}

export interface SubscribeOptions {
    queue?: string;
    consumerTag?: string;
    noAck?: boolean;
    exclusive?: boolean;
}