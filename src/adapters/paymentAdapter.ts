import { PaymentProvider } from "@prisma/client";

export interface ChargeData {
  amount: number;
  currency: string;
  description?: string;
}

export interface RefundData {
  paymentId: string;
  amount: number;
}

export interface PaymentAdapter {
  charge(data: ChargeData): Promise<any>;
  refund(data: RefundData): Promise<any>;
  fetchBalance(): Promise<number>;
  getProvider(): PaymentProvider;
}
