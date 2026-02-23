import { PaymentAdapter, ChargeData, RefundData } from "./paymentAdapter";
import { PaymentProvider } from "@prisma/client";

export class PayPalAdapter implements PaymentAdapter {
  async charge(data: ChargeData): Promise<any> {
    console.log(`PayPal: Charging ${data.amount} ${data.currency}`);
    return { success: true, transactionId: `pp_${Math.random().toString(36).substr(2, 9)}` };
  }

  async refund(data: RefundData): Promise<any> {
    console.log(`PayPal: Refunding ${data.amount} for ${data.paymentId}`);
    return { success: true, refundId: `re_${Math.random().toString(36).substr(2, 9)}` };
  }

  async fetchBalance(): Promise<number> {
    return 15000; // Simulated balance
  }

  getProvider(): PaymentProvider {
    return PaymentProvider.PAYPAL;
  }
}
