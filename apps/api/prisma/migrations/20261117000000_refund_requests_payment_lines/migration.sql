-- Refund requests (security check of 10 Nov 2026, No. 42; offer 6.3-6.6 and appendix 2). Additive only: new tables,
-- one column with a default, one small backfill; the running release keeps working.
-- "RefundRequest": one request per payment, with "RefundRequestLine" per course and the numbers of its count (6.4).
-- "PaymentLine": what each payment paid for each course, written at checkout and renewal: a course's refund is counted
--                from it, not from today's price. Payments made before this release have no lines.
-- "Payment"."refundedMinor": returned so far (partial refunds); state REFUNDED only once all of it is returned.
-- Checks keep the amounts consistent whatever the code does: never more returned than paid, REFUNDED means all of it,
-- no negative amounts, a request is open (PENDING, APPROVED) exactly while it holds its payment's "openKey".

-- CreateEnum
CREATE TYPE "RefundRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('REFUSAL', 'SCHEDULE_CHANGED', 'GROUP_CLOSED', 'LESSONS_NOT_HELD', 'NOT_AS_DESCRIBED', 'PLATFORM_FAULT', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundSource" AS ENUM ('CABINET', 'EMAIL');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundedMinor" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "courseId" TEXT NOT NULL,
    "listPriceMinor" BIGINT NOT NULL,
    "amountMinor" BIGINT NOT NULL,

    CONSTRAINT "PaymentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" "RefundReason" NOT NULL,
    "reasonText" TEXT,
    "source" "RefundSource" NOT NULL,
    "toOtherAccount" BOOLEAN NOT NULL DEFAULT false,
    "requestedMinor" BIGINT NOT NULL,
    "approvedMinor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "decisionDueAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "providerRef" TEXT,
    "openKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequestLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "refundRequestId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "lessonsTotal" INTEGER NOT NULL,
    "lessonsHeld" INTEGER NOT NULL,
    "amountMinor" BIGINT NOT NULL,

    CONSTRAINT "RefundRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentLine_tenantId_courseId_idx" ON "PaymentLine"("tenantId", "courseId");

-- CreateIndex
CREATE INDEX "PaymentLine_enrollmentId_idx" ON "PaymentLine"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLine_paymentId_enrollmentId_key" ON "PaymentLine"("paymentId", "enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequest_openKey_key" ON "RefundRequest"("openKey");

-- CreateIndex
CREATE INDEX "RefundRequest_tenantId_status_decisionDueAt_idx" ON "RefundRequest"("tenantId", "status", "decisionDueAt");

-- CreateIndex
CREATE INDEX "RefundRequest_tenantId_studentId_idx" ON "RefundRequest"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "RefundRequest_tenantId_paymentId_idx" ON "RefundRequest"("tenantId", "paymentId");

-- CreateIndex
CREATE INDEX "RefundRequest_subscriptionId_idx" ON "RefundRequest"("subscriptionId");

-- CreateIndex
CREATE INDEX "RefundRequestLine_tenantId_courseId_idx" ON "RefundRequestLine"("tenantId", "courseId");

-- CreateIndex
CREATE INDEX "RefundRequestLine_enrollmentId_idx" ON "RefundRequestLine"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequestLine_refundRequestId_enrollmentId_key" ON "RefundRequestLine"("refundRequestId", "enrollmentId");

-- AddForeignKey
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequestLine" ADD CONSTRAINT "RefundRequestLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequestLine" ADD CONSTRAINT "RefundRequestLine_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequestLine" ADD CONSTRAINT "RefundRequestLine_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequestLine" ADD CONSTRAINT "RefundRequestLine_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: payments refunded before this release were refunded in full.
UPDATE "Payment" SET "refundedMinor" = "amountMinor" WHERE "state" = 'REFUNDED';

-- Checks (Prisma does not model them; they live here).
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refundedMinor_check"
    CHECK ("refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor" AND ("state" <> 'REFUNDED' OR "refundedMinor" = "amountMinor"));
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_amounts_check"
    CHECK ("listPriceMinor" >= 0 AND "amountMinor" >= 0 AND "amountMinor" <= "listPriceMinor");
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_amounts_check"
    CHECK ("requestedMinor" >= 0 AND ("approvedMinor" IS NULL OR "approvedMinor" >= 0));
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_openKey_check"
    CHECK (CASE WHEN "status" IN ('PENDING', 'APPROVED') THEN "openKey" IS NOT NULL AND "openKey" = "paymentId" ELSE "openKey" IS NULL END);
ALTER TABLE "RefundRequestLine" ADD CONSTRAINT "RefundRequestLine_count_check"
    CHECK ("lessonsTotal" >= 0 AND "lessonsHeld" >= 0 AND "lessonsHeld" <= "lessonsTotal"
       AND "priceMinor" >= 0 AND "amountMinor" >= 0 AND "amountMinor" <= "priceMinor");
