-- Educational Center accounts (approval status, standing check-in QR, location and check-in window), per-lesson schedule
-- exceptions, automatic absences, period/lesson subscriptions with blocking, and in-app notifications.
-- Additive only: every new column has a default or is nullable, so the previous release keeps running during the rollout.

-- CreateEnum
CREATE TYPE "SubscriptionKind" AS ENUM ('PERIOD', 'LESSONS');

-- CreateEnum
CREATE TYPE "CenterStatus" AS ENUM ('PENDING', 'ACTIVE', 'BLOCKED');

-- AlterEnum (the new values are not used inside this migration, so one transaction is fine on PostgreSQL 12+)
ALTER TYPE "AttendanceMethod" ADD VALUE 'CENTER_QR';
ALTER TYPE "AttendanceMethod" ADD VALUE 'AUTO';

-- DropForeignKey
ALTER TABLE "AttendanceRecord" DROP CONSTRAINT "AttendanceRecord_recordedById_fkey";

-- AlterTable
ALTER TABLE "Center" ADD COLUMN     "absenceAfterMin" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "blockReason" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "checkInBeforeMin" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "checkInCode" TEXT,
ADD COLUMN     "checkInCodeRotatedAt" TIMESTAMP(3),
ADD COLUMN     "geoRadiusM" INTEGER,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "status" "CenterStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "accessKind" "SubscriptionKind" NOT NULL DEFAULT 'PERIOD',
ADD COLUMN     "lessonCount" INTEGER,
ADD COLUMN     "periodDays" INTEGER;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "blockReason" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "expiryReminderAt" TIMESTAMP(3),
ADD COLUMN     "graceEndsAt" TIMESTAMP(3),
ADD COLUMN     "kind" "SubscriptionKind" NOT NULL DEFAULT 'PERIOD',
ADD COLUMN     "lessonsTotal" INTEGER,
ADD COLUMN     "lessonsUsed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LessonSession" ADD COLUMN     "absenceMarkedAt" TIMESTAMP(3),
ADD COLUMN     "isExtra" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "rescheduledFromId" TEXT;

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "lessonCounted" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "recordedById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_tenantId_userId_readAt_createdAt_idx" ON "Notification"("tenantId", "userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Center_checkInCode_key" ON "Center"("checkInCode");

-- CreateIndex
CREATE INDEX "Center_tenantId_status_idx" ON "Center"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Subscription_tenantId_status_graceEndsAt_idx" ON "Subscription"("tenantId", "status", "graceEndsAt");

-- CreateIndex
CREATE INDEX "LessonSession_tenantId_absenceMarkedAt_startsAt_idx" ON "LessonSession"("tenantId", "absenceMarkedAt", "startsAt");

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lessons that already started before this release are treated as processed: nobody is marked absent retroactively.
UPDATE "LessonSession" SET "absenceMarkedAt" = CURRENT_TIMESTAMP WHERE "startsAt" < CURRENT_TIMESTAMP;
