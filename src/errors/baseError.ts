export abstract class BaseError extends Error {  
    public readonly code?: string;
    public readonly statusCode?: number;
    public readonly details?: any

    constructor(message: any, code: string, statusCode: number, details: any) {
        super(message);

        this.code = code;
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.details = details;

        Error.captureStackTrace(this, this.constructor);
    }
}