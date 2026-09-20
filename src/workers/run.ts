import "dotenv/config";
import { setTimeout } from "timers/promises";
import { prisma } from "../config/prisma";
import { PaymentService } from "../services/PaymentService.service";
import { OutboxPublisher } from "./outboxPublisher";
import { ActivityConsumer } from "./activityConsumer";

const payments = new PaymentService();
const publisher = new OutboxPublisher();
const consumer = new ActivityConsumer();
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function run() {
  try {
    await prisma.$connect();
    do {
      for (const [name, task] of [
        ["recovery", () => payments.recoverPending()],
        ["outbox", () => publisher.publishBatch()],
        ["consumer", () => consumer.consumeBatch()],
      ] as const) {
        try {
          await task();
        } catch (error) {
          console.error(
            JSON.stringify({ event: "worker_error", worker: name, error: String(error) }),
          );
        }
      }
      if (process.argv.includes("--once")) break;
      if (!stopping) await setTimeout(1000);
    } while (!stopping);
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
