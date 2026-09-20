import { Request, Response } from "express";
import { PaymentService } from "../services/PaymentService.service";
import { DomainError } from "../errors/domainError";
import { identifier } from "../domain/operation";

export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  createPayment = async (req: Request, res: Response) => {
    this.validateBody(req.body);
    const result = await this.paymentService.processPayment(req.body, res.locals.idempotencyKey, res.locals.subject);
    res.status(this.resultStatus(result.status)).json(result);
  };

  refundPayment = async (req: Request, res: Response) => {
    this.validateBody(req.body);
    const result = await this.paymentService.processRefund(req.body, res.locals.idempotencyKey, res.locals.subject);
    res.status(this.resultStatus(result.status)).json(result);
  };

  getPayment = async (req: Request, res: Response) => {
    res.json(await this.paymentService.getPayment(identifier(req.params.id, "paymentId"), res.locals.subject));
  };

  getRefund = async (req: Request, res: Response) => {
    res.json(await this.paymentService.getRefund(identifier(req.params.id, "refundId"), res.locals.subject));
  };

  private resultStatus(status: string) {
    return status === "SUCCEEDED" ? 200 : status === "FAILED" ? 422 : 202;
  }

  private validateBody(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DomainError("INVALID_BODY", "A JSON object is required");
    if ("amount" in body) throw new DomainError("AMOUNT_CONTRACT_CHANGED", "Use amountMinor in integer minor units; amount is no longer accepted");
    if ("scenario" in body && body.scenario !== "SUCCESS" && process.env.ALLOW_MOCK_SCENARIOS !== "true") {
      throw new DomainError("SCENARIOS_DISABLED", "Mock failure scenarios are disabled", 403);
    }
  }
}
