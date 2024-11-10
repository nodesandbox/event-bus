export class MessageProcessingError extends Error {
    constructor(message: string, public readonly originalError: Error) {
        super(message);
        this.name = "MessageProcessingError";
    }
}

export class RetryableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RetryableError";
    }
}
