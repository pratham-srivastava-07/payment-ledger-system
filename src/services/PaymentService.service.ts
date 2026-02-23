import { EventBus } from "../singletons/eventBus";
import { PrismaClass } from "../singletons/db";
import { PaymentAdapterFactory } from "../factories/paymentAdapterFactory";
import { PaymentProvider } from "@prisma/client";

export class PaymentService {
  private eventBus = EventBus.getInstance();
  private prisma = PrismaClass.getInstance();

  async processPayment(data: {
    paymentId: string;
    amount: number;
    provider: string;
    currency?: string;
  }) {
    const providerEnum = data.provider as PaymentProvider;
    const currency = data.currency || "USD";

    // 1. Idempotency Check
    const existingEvent = await this.prisma.paymentEvent.findUnique({
      where: { idempotencyKey: data.paymentId },
    });

    if (existingEvent) {
      return {
        message: "Payment already processed",
        status: "IDEMPOTENT",
        transactionId: existingEvent.id,
      };
    }

    // 2. Fetch Adapter
    const adapter = PaymentAdapterFactory.create(providerEnum);

    // 3. Persist Event (Idempotency Key)
    const paymentEvent = await this.prisma.paymentEvent.create({
      data: {
        provider: providerEnum,
        externalEventId: `ext_${data.paymentId}`,
        idempotencyKey: data.paymentId,
        payload: data as any,
        status: "RECEIVED",
      },
    });

    // 4. Call Adapter (External Payment)
    const adapterResult = await adapter.charge({
      amount: data.amount,
      currency: currency,
      description: `Payment for ID ${data.paymentId}`,
    });

    // 5. Emit Event for Ledger Recording
    this.eventBus.emit("payment.received", {
      paymentId: data.paymentId,
      amount: data.amount,
      currency: currency,
      provider: providerEnum,
      externalRef: adapterResult.transactionId,
    });

    // 6. Update Event Status
    await this.prisma.paymentEvent.update({
      where: { id: paymentEvent.id },
      data: { status: "PROCESSED", processed: true },
    });

    return {
      message: "Payment processed and event emitted",
      transactionId: adapterResult.transactionId,
    };
  }

  async processRefund(data: { paymentId: string; provider: string; amount: number }) {
    const providerEnum = data.provider as PaymentProvider;

    const adapter = PaymentAdapterFactory.create(providerEnum);

    // In a real system, we'd verify the original payment exists in our DB/Ledger

    const adapterResult = await adapter.refund({
      paymentId: data.paymentId,
      amount: data.amount,
    });

    this.eventBus.emit("refund.received", {
      paymentId: data.paymentId,
      amount: data.amount,
      currency: "USD", // Should be fetched from original transaction
      provider: providerEnum,
      externalRef: adapterResult.refundId,
    });

    return { message: "Refund processed and event emitted", refundId: adapterResult.refundId };
  }
}
