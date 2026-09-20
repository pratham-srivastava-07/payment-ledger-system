import { randomUUID } from "crypto";
import { OutboxEvent, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../config/prisma";

export interface EventTransport {
  publish(event: OutboxEvent): Promise<void>;
}

export class DatabaseInboxTransport implements EventTransport {
  constructor(private db: PrismaClient = prisma) {}

  async publish(event: OutboxEvent) {
    // Completion acknowledges durable receipt. Publisher marking is a separate commit.
    await this.db.inboxEvent.createMany({
      data: [
        {
          id: event.id,
          eventType: event.eventType,
          version: event.version,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
  }
}

export class OutboxPublisher {
  private transport: EventTransport;

  constructor(
    private db: PrismaClient = prisma,
    transport?: EventTransport,
    private maxAttempts = 8,
  ) {
    this.transport = transport ?? new DatabaseInboxTransport(db);
  }

  async publishBatch(limit = 25) {
    let count = 0;
    for (let i = 0; i < limit; i++) {
      const token = randomUUID();
      // Claim one at a time so leases do not expire while waiting in a local batch.
      const event = await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OutboxEvent[]>`
          SELECT * FROM "OutboxEvent"
          WHERE status = 'PENDING' AND "availableAt" <= NOW()
            AND ("leaseUntil" IS NULL OR "leaseUntil" <= NOW())
          ORDER BY "availableAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
        if (!rows[0]) return null;
        // A crashed attempt also counts; no infinite claim/crash loop after the limit.
        if (rows[0].attempts >= this.maxAttempts) {
          await tx.outboxEvent.update({
            where: { id: rows[0].id },
            data: {
              status: "FAILED",
              leaseToken: null,
              leaseUntil: null,
              lastError: "Delivery attempts exhausted; delivery may already have been accepted",
            },
          });
          return null;
        }
        return tx.outboxEvent.update({
          where: { id: rows[0].id },
          data: {
            attempts: { increment: 1 },
            leaseToken: token,
            leaseUntil: new Date(Date.now() + 30000),
          },
        });
      });
      if (!event) break;
      try {
        await this.transport.publish(event);
        await this.db.outboxEvent.updateMany({
          where: { id: event.id, leaseToken: token },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            leaseToken: null,
            leaseUntil: null,
            lastError: null,
          },
        });
        count++;
      } catch (error) {
        const delay =
          Math.min(60000, 1000 * 2 ** Math.min(event.attempts - 1, 6)) +
          Math.floor(Math.random() * 250);
        await this.db.outboxEvent.updateMany({
          where: { id: event.id, leaseToken: token },
          data: {
            status: event.attempts >= this.maxAttempts ? "FAILED" : "PENDING",
            availableAt: new Date(Date.now() + delay),
            leaseToken: null,
            leaseUntil: null,
            lastError: error instanceof Error ? error.message.slice(0, 1000) : "Publication failed",
          },
        });
      }
    }
    return count;
  }

  async retryFailed(id: string) {
    return this.db.outboxEvent.updateMany({
      where: { id, status: "FAILED" },
      data: {
        status: "PENDING",
        attempts: 0,
        availableAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      },
    });
  }
}
