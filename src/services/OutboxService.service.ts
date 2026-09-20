import { OutboxEventType, Prisma } from "@prisma/client";

export interface EventInput {
  eventType: OutboxEventType;
  aggregateType: "Payment" | "Refund";
  aggregateId: string;
  payload: Prisma.InputJsonObject;
}

export class OutboxService {
  createEvent(tx: Prisma.TransactionClient, event: EventInput) {
    return tx.outboxEvent.create({ data: { ...event, version: 1 } });
  }
}
