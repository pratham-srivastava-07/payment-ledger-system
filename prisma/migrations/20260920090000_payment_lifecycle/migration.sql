BEGIN;

-- Legacy ledger amounts were major-unit decimals. Convert exactly; never round.
-- Unknown currencies, fractional minor units or corrupt legacy journals abort the migration.
CREATE FUNCTION pg_temp.minor_factor(currency TEXT) RETURNS NUMERIC AS $$
BEGIN
  CASE currency
    WHEN 'USD', 'INR', 'EUR', 'GBP' THEN RETURN 100;
    WHEN 'JPY' THEN RETURN 1;
    WHEN 'KWD' THEN RETURN 1000;
    ELSE RAISE EXCEPTION 'Unsupported legacy currency: %', currency;
  END CASE;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Transaction" WHERE amount * pg_temp.minor_factor(currency) <> trunc(amount * pg_temp.minor_factor(currency)))
    OR EXISTS (SELECT 1 FROM "LedgerEntry" e JOIN "Transaction" t ON t.id = e."transactionId"
      WHERE e.debit * pg_temp.minor_factor(t.currency) <> trunc(e.debit * pg_temp.minor_factor(t.currency))
         OR e.credit * pg_temp.minor_factor(t.currency) <> trunc(e.credit * pg_temp.minor_factor(t.currency))) THEN
    RAISE EXCEPTION 'Legacy ledger contains fractional minor units; reconcile before migrating';
  END IF;
  IF EXISTS (SELECT 1 FROM "Transaction" t LEFT JOIN "LedgerEntry" e ON e."transactionId" = t.id
      GROUP BY t.id HAVING count(e.id) < 2 OR sum(e.debit) <> t.amount OR sum(e.credit) <> t.amount)
    OR EXISTS (SELECT 1 FROM "LedgerEntry" e JOIN "Transaction" t ON t.id = e."transactionId"
      JOIN "Account" a ON a.id = e."accountId" WHERE a.currency <> t.currency) THEN
    RAISE EXCEPTION 'Legacy ledger is unbalanced or mixes currencies; reconcile before migrating';
  END IF;
END;
$$;
UPDATE "LedgerEntry" e SET debit = e.debit * pg_temp.minor_factor(t.currency),
  credit = e.credit * pg_temp.minor_factor(t.currency)
  FROM "Transaction" t WHERE t.id = e."transactionId";
UPDATE "Transaction" SET amount = amount * pg_temp.minor_factor(currency);
-- Previous reconciliation was USD-only; report fields now contain exact minor units.
UPDATE "ReconciliationReport" SET "expectedBalance" = "expectedBalance" * 100,
  "actualBalance" = "actualBalance" * 100, discrepancy = discrepancy * 100;

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProcessorAttemptStatus" AS ENUM ('CREATED', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OutboxEventType" AS ENUM ('PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUND_SUCCEEDED', 'REFUND_FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "LedgerEntry" ALTER COLUMN "debit" SET DEFAULT 0,
ALTER COLUMN "debit" SET DATA TYPE BIGINT,
ALTER COLUMN "credit" SET DEFAULT 0,
ALTER COLUMN "credit" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "ReconciliationReport" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "reversalOfId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'COMPLETED',
ALTER COLUMN "amount" SET DATA TYPE BIGINT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "scenario" TEXT NOT NULL DEFAULT 'SUCCESS',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "ledgerTransactionId" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "scenario" TEXT NOT NULL DEFAULT 'SUCCESS',
    "status" "RefundStatus" NOT NULL DEFAULT 'CREATED',
    "ledgerTransactionId" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessorAttempt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "refundId" TEXT,
    "provider" "PaymentProvider" NOT NULL,
    "providerIdempotencyKey" TEXT NOT NULL,
    "externalRef" TEXT,
    "status" "ProcessorAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "invocations" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessorAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockProcessorOperation" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "kind" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockProcessorOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventType" "OutboxEventType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "consumer" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("consumer","eventId")
);

-- CreateTable
CREATE TABLE "SystemActivity" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_ledgerTransactionId_key" ON "Payment"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "Payment_status_nextAttemptAt_idx" ON "Payment"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_scope_idempotencyKey_key" ON "Payment"("scope", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_ledgerTransactionId_key" ON "Refund"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "Refund_paymentId_status_idx" ON "Refund"("paymentId", "status");

-- CreateIndex
CREATE INDEX "Refund_status_nextAttemptAt_idx" ON "Refund"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_scope_idempotencyKey_key" ON "Refund"("scope", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessorAttempt_paymentId_key" ON "ProcessorAttempt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessorAttempt_refundId_key" ON "ProcessorAttempt"("refundId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessorAttempt_providerIdempotencyKey_key" ON "ProcessorAttempt"("providerIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MockProcessorOperation_externalRef_key" ON "MockProcessorOperation"("externalRef");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_aggregateType_aggregateId_eventType_key" ON "OutboxEvent"("aggregateType", "aggregateId", "eventType");

-- CreateIndex
CREATE INDEX "InboxEvent_consumedAt_receivedAt_idx" ON "InboxEvent"("consumedAt", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemActivity_eventId_key" ON "SystemActivity"("eventId");

-- CreateIndex
CREATE INDEX "SystemActivity_createdAt_idx" ON "SystemActivity"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_type_name_currency_key" ON "Account"("type", "name", "currency");

-- CreateIndex
CREATE INDEX "Transaction_reversalOfId_idx" ON "Transaction"("reversalOfId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessorAttempt" ADD CONSTRAINT "ProcessorAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessorAttempt" ADD CONSTRAINT "ProcessorAttempt_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction" ADD CONSTRAINT journal_positive CHECK (amount > 0),
  ADD CONSTRAINT journal_posted CHECK (status = 'COMPLETED');
ALTER TABLE "LedgerEntry" ADD CONSTRAINT entry_one_side CHECK (
  (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
);
ALTER TABLE "Payment" ADD CONSTRAINT payment_positive CHECK ("amountMinor" > 0),
  ADD CONSTRAINT payment_posting CHECK ((status = 'SUCCEEDED') = ("ledgerTransactionId" IS NOT NULL));
ALTER TABLE "Refund" ADD CONSTRAINT refund_positive CHECK ("amountMinor" > 0),
  ADD CONSTRAINT refund_posting CHECK ((status = 'SUCCEEDED') = ("ledgerTransactionId" IS NOT NULL));
ALTER TABLE "ProcessorAttempt" ADD CONSTRAINT attempt_one_operation CHECK (
  ("paymentId" IS NOT NULL)::integer + ("refundId" IS NOT NULL)::integer = 1
);

CREATE FUNCTION reject_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Posted financial history is immutable; create a reversal';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER immutable_journal BEFORE UPDATE OR DELETE ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER immutable_entry BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE FUNCTION validate_journal() RETURNS TRIGGER AS $$
DECLARE
  journal_id TEXT;
  journal "Transaction"%ROWTYPE;
  debits NUMERIC;
  credits NUMERIC;
  entry_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'Transaction' THEN journal_id := NEW.id;
  ELSE journal_id := NEW."transactionId"; END IF;
  SELECT * INTO journal FROM "Transaction" WHERE id = journal_id;
  SELECT count(*), COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
    INTO entry_count, debits, credits FROM "LedgerEntry" WHERE "transactionId" = journal_id;
  IF entry_count < 2 OR debits <> journal.amount OR credits <> journal.amount THEN
    RAISE EXCEPTION 'Journal % must balance exactly to its amount', journal_id;
  END IF;
  IF EXISTS (SELECT 1 FROM "LedgerEntry" e JOIN "Account" a ON a.id = e."accountId"
    WHERE e."transactionId" = journal_id AND a.currency <> journal.currency) THEN
    RAISE EXCEPTION 'Journal account currency mismatch';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER balanced_journal AFTER INSERT ON "Transaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_journal();
CREATE CONSTRAINT TRIGGER balanced_entries AFTER INSERT ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_journal();

CREATE FUNCTION protect_account_identity() RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.currency, NEW.type, NEW.name) IS DISTINCT FROM (OLD.currency, OLD.type, OLD.name)
    AND EXISTS (SELECT 1 FROM "LedgerEntry" WHERE "accountId" = OLD.id) THEN
    RAISE EXCEPTION 'Cannot change the identity of a posted account';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER account_identity BEFORE UPDATE ON "Account"
  FOR EACH ROW EXECUTE FUNCTION protect_account_identity();

CREATE FUNCTION validate_operation_posting() RETURNS TRIGGER AS $$
DECLARE
  journal "Transaction"%ROWTYPE;
  operation_currency TEXT;
  original_journal TEXT;
BEGIN
  IF NEW.status <> 'SUCCEEDED' THEN RETURN NEW; END IF;
  SELECT * INTO journal FROM "Transaction" WHERE id = NEW."ledgerTransactionId";
  IF TG_TABLE_NAME = 'Payment' THEN
    operation_currency := NEW.currency;
    IF journal.type <> 'PAYMENT' THEN RAISE EXCEPTION 'Payment requires payment journal'; END IF;
  ELSE
    SELECT currency, "ledgerTransactionId" INTO operation_currency, original_journal FROM "Payment" WHERE id = NEW."paymentId";
    IF journal.type <> 'REFUND' OR journal."reversalOfId" IS DISTINCT FROM original_journal THEN
      RAISE EXCEPTION 'Refund must reverse its original payment journal';
    END IF;
  END IF;
  IF journal.amount <> NEW."amountMinor" OR journal.currency <> operation_currency THEN
    RAISE EXCEPTION 'Operation and journal amount/currency mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_posting_matches BEFORE INSERT OR UPDATE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION validate_operation_posting();
CREATE TRIGGER refund_posting_matches BEFORE INSERT OR UPDATE ON "Refund"
  FOR EACH ROW EXECUTE FUNCTION validate_operation_posting();

CREATE FUNCTION protect_operation() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('SUCCEEDED', 'FAILED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal payment/refund cannot be changed';
  END IF;
  IF (NEW.id, NEW.scope, NEW."idempotencyKey", NEW."requestHash", NEW."amountMinor", NEW.scenario)
    IS DISTINCT FROM (OLD.id, OLD.scope, OLD."idempotencyKey", OLD."requestHash", OLD."amountMinor", OLD.scenario) THEN
    RAISE EXCEPTION 'Operation identity cannot be changed';
  END IF;
  IF TG_TABLE_NAME = 'Payment' THEN
    IF (NEW.currency, NEW.provider) IS DISTINCT FROM (OLD.currency, OLD.provider) THEN
      RAISE EXCEPTION 'Payment currency/provider cannot be changed';
    END IF;
  ELSE
    IF NEW."paymentId" <> OLD."paymentId" THEN RAISE EXCEPTION 'Refund payment cannot be changed'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_identity BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION protect_operation();
CREATE TRIGGER refund_identity BEFORE UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION protect_operation();

COMMIT;
