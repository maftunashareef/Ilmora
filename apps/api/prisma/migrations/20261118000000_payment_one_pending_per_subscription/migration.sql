-- One unpaid (PENDING) payment per subscription, guaranteed by the database (Nozim's request: «Доработки Ilmora» Н6,
-- re-check 11.11 №80 — two simultaneous «Renew» clicks made two payments for one month). The code already locks the
-- subscription row and looks for an unpaid payment inside the transaction (01d259c); this index makes any other path
-- that would create a second one fail with a unique violation (P2002, 409) instead of succeeding.
-- Prisma does not describe partial indexes in schema.prisma; this one lives here, like the CHECKs of 20261117000000.
-- In one transaction with a lock timeout (security review 11.11, №87 and №122): it applies entirely or not at all,
-- and never queues behind the nightly backup for long.
BEGIN;
SET LOCAL lock_timeout = '3s';

-- Duplicates that already exist would stop the index: of several PENDING payments of one subscription the newest stays,
-- the others are cancelled (and recorded in the audit log). A PENDING payment has not been paid: nothing to refund.
WITH ranked AS (
  SELECT "id", "tenantId", "subscriptionId",
         row_number() OVER (PARTITION BY "subscriptionId" ORDER BY "createdAt" DESC, "id" DESC) AS n
  FROM "Payment" WHERE "state" = 'PENDING'
), cancelled AS (
  UPDATE "Payment" p SET "state" = 'CANCELLED', "cancelledAt" = now(), "updatedAt" = now()
  FROM ranked r WHERE p."id" = r."id" AND r.n > 1
  RETURNING p."id", p."tenantId", p."subscriptionId"
)
INSERT INTO "AuditEvent" ("id", "tenantId", "action", "entityType", "entityId", "before", "after", "reason")
SELECT 'mig-pend-' || c."id", c."tenantId", 'payment.cancelled', 'Payment', c."id",
       '{"state":"PENDING"}'::jsonb, jsonb_build_object('state', 'CANCELLED', 'subscriptionId', c."subscriptionId"),
       'migration 20261118000000: a newer unpaid payment of the same subscription exists'
FROM cancelled c;

CREATE UNIQUE INDEX "Payment_one_pending_per_subscription" ON "Payment" ("subscriptionId") WHERE "state" = 'PENDING';

COMMIT;
