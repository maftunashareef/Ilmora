-- Acceptance of the public offer and personal-data consent (shared/legal: OFFER_VERSION). Additive; existing rows keep NULLs
-- and are asked to accept on their next sign-in.
ALTER TABLE "User"
  ADD COLUMN "offerAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "offerVersion" TEXT,
  ADD COLUMN "consentAt" TIMESTAMP(3),
  ADD COLUMN "consentAbroad" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "marketingAt" TIMESTAMP(3);
