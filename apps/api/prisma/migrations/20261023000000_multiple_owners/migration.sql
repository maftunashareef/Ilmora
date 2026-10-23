-- Super Admin moves from one Tenant.ownerUserId to a per-user flag, so a tenant can have several owners.
-- Tenant.ownerUserId stays for one release (backward compatible: the previous release still reads it); dropped later.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isOwner" BOOLEAN NOT NULL DEFAULT false;

-- Keep the currently configured owner.
UPDATE "User" SET "isOwner" = true FROM "Tenant" WHERE "Tenant"."ownerUserId" = "User"."id";
