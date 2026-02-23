-- CreateTable
CREATE TABLE "Idempotency" (
    "key" TEXT NOT NULL,
    "requestPath" TEXT NOT NULL,
    "requestBodyHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "Idempotency_pkey" PRIMARY KEY ("key")
);
