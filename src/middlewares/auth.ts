import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { DomainError } from "../errors/domainError";

export class AuthMiddleware {
  static verifyToken(req: Request, res: Response, next: NextFunction) {
    const secret = process.env.JWT_SECRET;
    if (!secret)
      throw new DomainError("AUTH_NOT_CONFIGURED", "Authentication is not configured", 503);
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "");
    if (!match) throw new DomainError("UNAUTHORIZED", "A Bearer token is required", 401);
    try {
      const decoded = jwt.verify(match[1], secret, { algorithms: ["HS256"] });
      if (typeof decoded === "string" || !decoded.sub || decoded.sub.length > 128)
        throw new Error("Missing subject");
      res.locals.subject = decoded.sub;
    } catch {
      throw new DomainError("UNAUTHORIZED", "Invalid or expired token", 401);
    }
    next();
  }
}
