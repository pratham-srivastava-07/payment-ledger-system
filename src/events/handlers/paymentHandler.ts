import { LedgerService } from "../../services/LedgerService.service";
import { EventBus } from "../../singletons/eventBus";
import { TransactionType, AccountType } from "@prisma/client";

export class PaymentHandler {
  private ledgerService = new LedgerService();
  private eventBus = EventBus.getInstance();

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    this.eventBus.on("payment.received", this.handlePaymentReceived);
    this.eventBus.on("refund.received", this.handleRefundReceived);
  }

  // what this.func.bind(this) does is creates a new function everytime its called, memory overhead and messier code 
  // instead we can use arrow functions
  // this.func.bind(this) is used to bind the this keyword to the function
  // arrow functions are lexically scoped, so they automatically bind the this keyword to the function
  // this is why we use arrow functions instead of this.func.bind(this)

  private handlePaymentReceived = async(data: {
    paymentId: string;
    amount: number;
    currency: string;
    provider: string;
    externalRef: string;
  }) => {
    console.log(`[PaymentHandler] Processing ledger entry for payment: ${data.paymentId}`);

    try {
      // Get or create necessary accounts
      const providerAccount = await this.ledgerService.getSystemAccount(
        AccountType.PROVIDER,
        `${data.provider}_HOLDING`,
        data.currency,
      );
      const platformAccount = await this.ledgerService.getSystemAccount(
        AccountType.PLATFORM,
        "REVENUE_ACCOUNT",
        data.currency,
      );

      // Double-entry: Debit Provider (Asset increases), Credit Platform (Revenue increases)
      await this.ledgerService.recordTransaction({
        type: TransactionType.PAYMENT,
        amount: data.amount,
        currency: data.currency,
        externalRef: data.paymentId,
        description: `Payment from ${data.provider} - Ref: ${data.externalRef}`,
        entries: [
          { accountId: providerAccount.id, debit: data.amount, credit: 0 },
          { accountId: platformAccount.id, debit: 0, credit: data.amount },
        ],
      });

      console.log(`[PaymentHandler] Ledger entry created for ${data.paymentId}`);
    } catch (error) {
      console.error(`[PaymentHandler] Failed to record payment in ledger:`, error);
    }
  }

  private  handleRefundReceived = async (data: {
    paymentId: string;
    amount: number;
    currency: string;
    provider: string;
    externalRef: string;
  }) => {
    console.log(`[PaymentHandler] Processing ledger entry for refund: ${data.paymentId}`);

    try {
      const providerAccount = await this.ledgerService.getSystemAccount(
        AccountType.PROVIDER,
        `${data.provider}_HOLDING`,
        data.currency,
      );
      const platformAccount = await this.ledgerService.getSystemAccount(
        AccountType.PLATFORM,
        "REVENUE_ACCOUNT",
        data.currency,
      );

      // Double-entry (Reverse): Debit Platform (Reverse Revenue), Credit Provider (Decrease Asset)
      await this.ledgerService.recordTransaction({
        type: TransactionType.REFUND,
        amount: data.amount,
        currency: data.currency,
        externalRef: `REFUND_${data.paymentId}`,
        description: `Refund for ${data.paymentId} - Ref: ${data.externalRef}`,
        entries: [
          { accountId: platformAccount.id, debit: data.amount, credit: 0 },
          { accountId: providerAccount.id, debit: 0, credit: data.amount },
        ],
      });

      console.log(`[PaymentHandler] Ledger entry created for refund of ${data.paymentId}`);
    } catch (error) {
      console.error(`[PaymentHandler] Failed to record refund in ledger:`, error);
    }
  }
}
