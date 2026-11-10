-- Registry fixes after the security check of 10 Nov 2026 (code: backend chat). Additive only: nullable columns, no
-- indexes, no rewrite of existing rows except two small backfills below; the running release keeps working.
-- No. 13, 46: "pendingChanges" holds a change to reviewed fields after approval until the Super Admin decides;
--             "blockedAt" / "blockReason" / "blockedById" — blocking by the Super Admin (Institution, Company).
-- No. 15:     "sharedName" / "sharedPhone" / "sharedEmail" — contacts as the student agreed to show them
--             (ContactRequest, VacancyApplication); personal data, cleared when the student withdraws.
-- No. 17:     "Institution"."claimedAt" — when the representative took the record (abandoned drafts are released).
-- No. 18:     "Institution"."officialName" — the name in the ministry's list.
-- "User"."passwordIssuedAt" — a password issued by the Super Admin that the owner has not changed yet.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "blockReason" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedById" TEXT,
ADD COLUMN     "pendingChanges" JSONB;

-- AlterTable
ALTER TABLE "ContactRequest" ADD COLUMN     "sharedEmail" TEXT,
ADD COLUMN     "sharedName" TEXT,
ADD COLUMN     "sharedPhone" TEXT;

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "blockReason" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedById" TEXT,
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "officialName" TEXT,
ADD COLUMN     "pendingChanges" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordIssuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VacancyApplication" ADD COLUMN     "sharedEmail" TEXT,
ADD COLUMN     "sharedName" TEXT,
ADD COLUMN     "sharedPhone" TEXT;

-- Backfill (No. 17): records that already have a representative count from this release, so nobody's draft is
-- released at once.
UPDATE "Institution" AS i
SET "claimedAt" = (now() AT TIME ZONE 'UTC')
WHERE i."claimedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "User" AS u WHERE u."institutionId" = i."id");

-- Backfill (No. 18): imported records nobody has taken still carry the list's name. Taken ones get the official name
-- from the list itself (prisma/import-technikums.ts --apply), because a representative may have edited theirs.
UPDATE "Institution"
SET "officialName" = "name"
WHERE "source" = 'IMPORT' AND "status" = 'UNCLAIMED' AND "officialName" IS NULL;
