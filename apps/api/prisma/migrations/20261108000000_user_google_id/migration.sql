-- Google Sign-In matches accounts by the Google account id ("sub") only.
-- Before this, accounts were looked up by the part of the e-mail before "@", so a different Google account with the
-- same local part (anvar@gmail.com vs anvar@mail.ru) signed into someone else's account.
--
-- Backfill: accounts created through Google never stored the id on "User", but every one has an "auth.register" audit
-- row with after.method = 'google' and after.googleId. The earliest such row links the id to its account. If one Google
-- id ever created several accounts (possible under the old lookup), only the earliest account is linked; the others
-- stay reachable by login/password/phone as before and are not touched. No other data is changed.
-- Undo: DROP INDEX "User_tenantId_googleId_key"; ALTER TABLE "User" DROP COLUMN "googleId";

ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

CREATE UNIQUE INDEX "User_tenantId_googleId_key" ON "User"("tenantId", "googleId");

UPDATE "User" u
SET "googleId" = src.google_id
FROM (
  SELECT DISTINCT ON (a."tenantId", a."after"->>'googleId')
         a."tenantId" AS tenant_id, a."entityId" AS user_id, a."after"->>'googleId' AS google_id
  FROM "AuditEvent" a
  WHERE a."action" = 'auth.register'
    AND a."entityType" = 'User'
    AND a."after"->>'method' = 'google'
    AND COALESCE(a."after"->>'googleId', '') <> ''
  ORDER BY a."tenantId", a."after"->>'googleId', a."createdAt" ASC
) src
WHERE u."id" = src.user_id
  AND u."tenantId" = src.tenant_id
  AND u."googleId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "User" x WHERE x."tenantId" = src.tenant_id AND x."googleId" = src.google_id);
