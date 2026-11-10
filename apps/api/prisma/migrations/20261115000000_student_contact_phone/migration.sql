-- Registry: the student's contact phone from the questionnaire, apart from the sign-in number ("User"."phoneE164").
-- Not checked by SMS, so it must never become a sign-in number: writing an unchecked number into "phoneE164" would let
-- anyone take someone else's number. Additive only: one nullable column.

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "contactPhone" TEXT;
