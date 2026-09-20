import { MockPaymentAdapter } from "./mockPaymentAdapter";

export class RazorpayAdapter extends MockPaymentAdapter {
  constructor() {
    super("RAZORPAY");
  }
}
