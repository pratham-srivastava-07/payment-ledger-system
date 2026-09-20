import { MockPaymentAdapter } from "./mockPaymentAdapter";

export class StripeAdapter extends MockPaymentAdapter {
  constructor() {
    super("STRIPE");
  }
}
