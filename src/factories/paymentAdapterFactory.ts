import { PaymentProvider } from "@prisma/client";
import { PaymentAdapter } from "../adapters/paymentAdapter";
import { StripeAdapter } from "../adapters/stripeAdapter";
import { RazorpayAdapter } from "../adapters/razorpayAdapter";
import { PayPalAdapter } from "../adapters/paypalAdapter";

export class PaymentAdapterFactory {
  static create(provider: PaymentProvider): PaymentAdapter {
    switch (provider) {
      case PaymentProvider.STRIPE:
        return new StripeAdapter();
      case PaymentProvider.RAZORPAY:
        return new RazorpayAdapter();
      case PaymentProvider.PAYPAL:
        return new PayPalAdapter();
      default:
        throw new Error(`Unsupported payment provider: ${provider}`);
    }
  }
}
