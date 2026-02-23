import { PaymentAdapter, ChargeData, RefundData } from "./paymentAdapter";
import { PaymentProvider } from "@prisma/client";

export class RazorpayAdapter implements PaymentAdapter {
  async charge(data: ChargeData): Promise<any> {
    console.log(`Razorpay: Charging ${data.amount} ${data.currency}`);
    return { success: true, transactionId: `rzp_${Math.random().toString(36).substr(2, 9)}` };
  }

  async refund(data: RefundData): Promise<any> {
    console.log(`Razorpay: Refunding ${data.amount} for ${data.paymentId}`);
    return { success: true, refundId: `re_${Math.random().toString(36).substr(2, 9)}` };
  }

  async fetchBalance(): Promise<number> {
    return 25000; // Simulated balance
  }

  getProvider(): PaymentProvider {
    return PaymentProvider.RAZORPAY;
  }
}
