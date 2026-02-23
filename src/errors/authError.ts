import { unknown } from "zod";
import { BaseError } from "./baseError";

export class AuthError extends BaseError {
    constructor(message="Authentication Error", details = undefined) {
        super(message, "AUTH_ERROR", 401, details);
    }
}