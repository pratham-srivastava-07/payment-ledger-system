import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import crypto from "crypto";

export class IdempotencyMiddleware {
    static async checkIdempotency(req: Request, res: Response, next: NextFunction) {
        const idempotencyKey = req.headers["x-idempotency-key"] as string;

        if (!idempotencyKey) {
            return res.status(400).json({ error: "Missing x-idempotency-key header" });
        }

        // Hash the request body to ensure the key is used for the same payload
        const bodyHash = crypto
            .createHash("sha256")
            .update(JSON.stringify(req.body || {}))
            .digest("hex");

        const existingEntry = await prisma.idempotency.findUnique({
            where: { key: idempotencyKey },
        });

        if (existingEntry) {
            // Check if the payload matches the original request
            if (existingEntry.requestBodyHash !== bodyHash) {
                return res.status(400).json({
                    error: "Idempotency key reused with different payload contents",
                });
            }

            // If already processed, return the cached result
            if (existingEntry.responseJson) {
                return res.status(existingEntry.responseStatus || 200).json(existingEntry.responseJson);
            }

            // If record exists but no response, it's still being processed
            return res.status(409).json({
                error: "A request with this idempotency key is already in progress.",
            });
        }

        // Create the record to "lock" it
        await prisma.idempotency.create({
            data: {
                key: idempotencyKey,
                requestPath: req.path,
                requestBodyHash: bodyHash,
                lockedAt: new Date(),
            },
        });

        // Monkey-patch res.json to capture the response
        const originalJson = res.json.bind(res);
        res.json = (body: any) => {
            // Capture the response in the background
            prisma.idempotency
                .update({
                    where: { key: idempotencyKey },
                    data: {
                        responseJson: body,
                        responseStatus: res.statusCode,
                        lockedAt: null, // Unlock
                    },
                })
                .catch((err) => console.error("Failed to store idempotency response:", err));

            return originalJson(body);
        };

        next();
    }
}