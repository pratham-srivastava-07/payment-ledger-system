import { NextFunction, Request, Response } from "express";
import { identifier } from "../domain/operation";

export class IdempotencyMiddleware {
  static checkIdempotency(req: Request, res: Response, next: NextFunction) {
    res.locals.idempotencyKey = identifier(req.headers["x-idempotency-key"], "x-idempotency-key");
    // Claim and replay are part of durable operation creation, not response interception.
    next();
  }
}
