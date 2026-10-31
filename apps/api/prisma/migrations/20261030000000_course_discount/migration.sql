-- Course discounts: one optional discount window per course, managed by the center / Super Admin.
-- Additive and nullable: existing rows and the previous release keep working (no discount = list price).
-- Rules (percent 1..20, endsAt > startsAt, all three set together) are enforced in the API, not by a CHECK constraint.
-- Rollback: ALTER TABLE "Course" DROP COLUMN "discountPercent", DROP COLUMN "discountStartsAt", DROP COLUMN "discountEndsAt";

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "discountPercent" INTEGER,
ADD COLUMN     "discountStartsAt" TIMESTAMP(3),
ADD COLUMN     "discountEndsAt" TIMESTAMP(3);
