-- One contact request per company, student AND source (cybersecurity check 9.4, 11.11). With one request per company and
-- student, «Заинтересованы» on an anonymous contract-help card answered 409 `contact_request_exists` when the company had
-- already invited the same student by name from a graduation announcement (and the other way round) — the anonymous card
-- was linked to the named graduate. Now each source keeps its own request: the student decides each one.
-- The new key is wider than the old one, so the rows that exist already satisfy it.
-- In one transaction with a lock timeout (security review 11.11, №87 and №122).
BEGIN;
SET LOCAL lock_timeout = '3s';

DROP INDEX "ContactRequest_companyId_userId_key";
CREATE UNIQUE INDEX "ContactRequest_companyId_userId_source_key" ON "ContactRequest"("companyId", "userId", "source");

COMMIT;
