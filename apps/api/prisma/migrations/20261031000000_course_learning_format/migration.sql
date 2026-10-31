-- Learning format: every existing course stays OFFLINE; ONLINE courses are free external links (no groups).
-- Additive: new enum types, one defaulted column for each enum, and nullable text columns. The previous release keeps working.
-- Rules (ONLINE needs an https link and a provider, price 0, no groups; only the Super Admin sets ONLINE) are enforced in the API.
-- Rollback: DROP INDEX "Course_tenantId_learningFormat_idx";
--   ALTER TABLE "Course" DROP COLUMN "learningFormat", DROP COLUMN "externalUrl", DROP COLUMN "providerName",
--     DROP COLUMN "instructorName", DROP COLUMN "certificate", DROP COLUMN "durationText";
--   DROP TYPE "LearningFormat"; DROP TYPE "CertificateKind";

-- CreateEnum
CREATE TYPE "LearningFormat" AS ENUM ('OFFLINE', 'ONLINE');

-- CreateEnum
CREATE TYPE "CertificateKind" AS ENUM ('NONE', 'FREE', 'PAID');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "learningFormat" "LearningFormat" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "externalUrl" TEXT,
ADD COLUMN     "providerName" TEXT,
ADD COLUMN     "instructorName" TEXT,
ADD COLUMN     "certificate" "CertificateKind" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "durationText" JSONB;

-- CreateIndex
CREATE INDEX "Course_tenantId_learningFormat_idx" ON "Course"("tenantId", "learningFormat");
