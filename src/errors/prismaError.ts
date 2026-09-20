import { BaseError } from "./baseError";

export class PrismaError extends BaseError {
  constructor(message = "PrismaError", details = undefined) {
    super(message, "PRISMA_ERROR", 502, details);
  }
}
