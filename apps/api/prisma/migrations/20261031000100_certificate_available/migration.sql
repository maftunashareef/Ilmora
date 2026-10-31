-- Certificate "AVAILABLE": the provider offers a certificate but its course page does not say whether it is free.
-- Additive (a new enum value); nothing uses it until a course is saved with it.
-- Rollback: PostgreSQL cannot drop an enum value; rows never use it before this release, so leaving it is harmless.

-- AlterEnum
ALTER TYPE "CertificateKind" ADD VALUE 'AVAILABLE';
