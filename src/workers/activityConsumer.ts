import { InboxEvent, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../config/prisma";

export class ActivityConsumer {
  constructor(private db: PrismaClient = prisma) {}

  async consumeBatch(limit = 25) {
    let count = 0;
    for (let i = 0; i < limit; i++) {
      const consumed = await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<InboxEvent[]>`
          SELECT * FROM "InboxEvent" WHERE "consumedAt" IS NULL
          ORDER BY "receivedAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
        const event = rows[0];
        if (!event) return false;
        if (event.version !== 1) throw new Error(`Unsupported event version: ${event.version}`);
        const claim = await tx.processedEvent.createMany({
          data: [{ consumer: "system-activity-v1", eventId: event.id }],
          skipDuplicates: true,
        });
        if (claim.count)
          await tx.systemActivity.create({
            data: {
              eventId: event.id,
              eventType: event.eventType,
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              payload: event.payload as Prisma.InputJsonValue,
            },
          });
        // Local effect, deduplication and ACK share one transaction.
        await tx.inboxEvent.update({ where: { id: event.id }, data: { consumedAt: new Date() } });
        return true;
      });
      if (!consumed) break;
      count++;
    }
    return count;
  }
}
