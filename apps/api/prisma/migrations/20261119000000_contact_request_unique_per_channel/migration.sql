-- Contact requests: one per channel instead of one per company and student (security review 11.11, №126; Nozim's
-- request). With one rule for both channels, a company that had invited a graduate by name got 409 «already asked» on
-- that student's anonymous contract-help card, and the reverse — the error itself told it the two cards are one person.
-- Now: from announcements one request per company and student; from an anonymous card one request per company and card.
-- Prisma does not describe partial indexes: they live here (schema.prisma keeps only a comment). No code uses the old
-- compound key; a duplicate within a channel still answers P2002 → 409 contact_request_exists.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

DROP INDEX "ContactRequest_companyId_userId_key";

CREATE UNIQUE INDEX "ContactRequest_graduate_once" ON "ContactRequest" ("companyId", "userId") WHERE "source" = 'GRADUATE';

CREATE UNIQUE INDEX "ContactRequest_contract_help_once" ON "ContactRequest" ("companyId", "contractHelpId") WHERE "source" = 'CONTRACT_HELP';

COMMIT;
