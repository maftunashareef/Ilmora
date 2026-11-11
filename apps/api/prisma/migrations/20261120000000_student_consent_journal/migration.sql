-- The consent journal (ТЗ 8; «Последние доработки ILMORA» 11.11, Т-4 and Т-5).
-- Т-4: the journal no longer disappears with the account. StudentConsent.userId was ON DELETE CASCADE, so a hard delete
--      of a user erased the history of their consents and revocations, which the law and ТЗ 8 require to keep (with
--      «who gave it»). Now RESTRICT: accounts are soft-deleted as before; a hard delete of a user with consents is
--      refused. The demo purge (src/cli/purge-demo.ts) removes demo students' consents first.
-- Т-5: one active consent of each kind per student, held by the database: partial unique index
--      "StudentConsent_one_active_per_kind" (userId, kind) WHERE revokedAt IS NULL AND companyId IS NULL. The code already
--      adds a row only when none is active; the index stops a race or a future path from adding a second one.
--      COMPANY_CONTACTS (per company, companyId set) is not covered: a student may open contacts to a company twice.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

-- Т-4
ALTER TABLE "StudentConsent" DROP CONSTRAINT "StudentConsent_userId_fkey";
ALTER TABLE "StudentConsent" ADD CONSTRAINT "StudentConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Т-5. Duplicates would stop the index: of several active rows of one kind the newest stays active; each older one is
-- closed at the moment the newest was given (it was superseded then), and the change is written to the audit log. The
-- student's current consents do not change.
WITH active AS (
  SELECT "id", "tenantId", "userId", "kind", "givenAt",
         row_number() OVER (PARTITION BY "userId", "kind" ORDER BY "givenAt" DESC, "id" DESC) AS n,
         first_value("givenAt") OVER (PARTITION BY "userId", "kind" ORDER BY "givenAt" DESC, "id" DESC) AS newest
  FROM "StudentConsent" WHERE "revokedAt" IS NULL AND "companyId" IS NULL
), closed AS (
  UPDATE "StudentConsent" c SET "revokedAt" = a.newest
  FROM active a WHERE c."id" = a."id" AND a.n > 1
  RETURNING c."id", c."tenantId", c."userId", c."kind", c."revokedAt"
)
INSERT INTO "AuditEvent" ("id", "tenantId", "action", "entityType", "entityId", "before", "after", "reason")
SELECT 'mig-consent-' || c."id", c."tenantId", 'consent.superseded', 'StudentConsent', c."id",
       '{"revokedAt":null}'::jsonb,
       jsonb_build_object('revokedAt', c."revokedAt", 'userId', c."userId", 'kind', c."kind"),
       'migration 20261120000000: a newer active consent of the same kind exists'
FROM closed c;

CREATE UNIQUE INDEX "StudentConsent_one_active_per_kind" ON "StudentConsent" ("userId", "kind")
  WHERE "revokedAt" IS NULL AND "companyId" IS NULL;

COMMIT;
