export interface DeadLetterDetails {
    messageId: string;
    failureReason: string;
    retryCount: number;
    timestamp: string;
    originalExchange: string;
    originalRoutingKey: string;
    content: string;
    headers: Record<string, any>;
    error?: Error;
}
