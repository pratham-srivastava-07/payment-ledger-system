import { ErrorRequestHandler } from "express";
import { DomainError } from "../errors/domainError";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof DomainError) {
    res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Malformed JSON body" } });
    return;
  }
  console.error(JSON.stringify({ event: "request_error", error: String(error) }));
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Request failed; retry using the same idempotency key" } });
};
