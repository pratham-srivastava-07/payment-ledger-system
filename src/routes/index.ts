import { Router } from "express";
import { PaymentController } from "../controllers/paymentController";
import { LedgerController } from "../controllers/ledgerController";
import { ReconciliationController } from "../controllers/reconciliationController";
import { PaymentService } from "../services/PaymentService.service";
import { LedgerService } from "../services/LedgerService.service";
import { ReconciliationService } from "../services/ReconciliationService.service";
import { AuthMiddleware } from "../middlewares/auth";
import { IdempotencyMiddleware } from "../middlewares/idempotency";
import { prisma } from "../config/prisma";
import { OutboxPublisher } from "../workers/outboxPublisher";
import { identifier } from "../domain/operation";
import { consoleRouter } from "./console.route";

const router = Router();

// Dependency Injection
const paymentService = new PaymentService();
const ledgerService = new LedgerService();
const reconciliationService = new ReconciliationService();

const paymentController = new PaymentController(paymentService);
const ledgerController = new LedgerController(ledgerService);
const reconciliationController = new ReconciliationController(reconciliationService);

// middlewares
const authMiddleware = AuthMiddleware.verifyToken;
const idempotencyMiddleware = IdempotencyMiddleware.checkIdempotency;
router.use("/console", authMiddleware, consoleRouter);

// Routes
router.post("/payments", authMiddleware, idempotencyMiddleware, paymentController.createPayment);
router.post("/refunds", authMiddleware, idempotencyMiddleware, paymentController.refundPayment);
router.get("/payments/:id", authMiddleware, paymentController.getPayment);
router.get("/refunds/:id", authMiddleware, paymentController.getRefund);

router.get("/ledger/:accountId", authMiddleware, ledgerController.getLedgerForAccount);

router.get("/reconciliation/report", authMiddleware, reconciliationController.getLatestReport);
router.post(
  "/reconciliation/trigger",
  authMiddleware,
  reconciliationController.triggerReconciliation,
);

// Tokens represent trusted operators; ledger and delivery diagnostics are system-wide.
router.get("/outbox", authMiddleware, async (_req, res) => {
  res.json(await prisma.outboxEvent.findMany({ take: 100, orderBy: { createdAt: "desc" } }));
});
router.post("/outbox/:id/retry", authMiddleware, async (req, res) => {
  const id = identifier(req.params.id, "eventId");
  const result = await new OutboxPublisher().retryFailed(id);
  res.status(result.count ? 202 : 409).json({ eventId: id, requeued: result.count === 1 });
});
router.get("/activity", authMiddleware, async (_req, res) => {
  res.json(await prisma.systemActivity.findMany({ take: 100, orderBy: { createdAt: "desc" } }));
});

export { router };
