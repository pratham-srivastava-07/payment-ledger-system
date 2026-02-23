import { Router } from "express";
import { PaymentController } from "../controllers/paymentController";
import { LedgerController } from "../controllers/ledgerController";
import { ReconciliationController } from "../controllers/reconciliationController";
import { PaymentService } from "../services/PaymentService.service";
import { LedgerService } from "../services/LedgerService.service";
import { ReconciliationService } from "../services/ReconciliationService.service";
import { AuthMiddleware } from "../middlewares/auth";
import { IdempotencyMiddleware } from "../middlewares/idempotency";

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

// Routes
router.post("/payments", authMiddleware, idempotencyMiddleware, paymentController.createPayment);
router.post("/refunds", authMiddleware, idempotencyMiddleware, paymentController.refundPayment);

router.get("/ledger/:accountId", authMiddleware, ledgerController.getLedgerForAccount);

router.get("/reconciliation/report", authMiddleware, reconciliationController.getLatestReport);
router.post("/reconciliation/trigger", reconciliationController.triggerReconciliation);

export { router };
