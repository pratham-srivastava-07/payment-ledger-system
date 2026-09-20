import { Prisma, PrismaClient } from "@prisma/client";
import { setTimeout } from "timers/promises";

// Only local database work belongs in this closure; processor calls must stay outside.
export async function serializable<T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 10000,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt >= 7) {
        throw error;
      }
      await setTimeout(Math.min(250, 10 * 2 ** attempt) + Math.random() * 20);
    }
  }
}
