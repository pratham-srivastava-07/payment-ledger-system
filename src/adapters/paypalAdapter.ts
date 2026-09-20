import { MockPaymentAdapter } from "./mockPaymentAdapter";

export class PayPalAdapter extends MockPaymentAdapter {
  constructor() {
    super("PAYPAL");
  }
}
