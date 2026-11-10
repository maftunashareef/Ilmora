-- Registry: the official list of technikums (stat.edu.uz, 9 Nov 2026) goes into "Institution" with the same ids the
-- web app uses ("pe-<id>"). Additive only: four nullable columns on "Institution" and one on "Region", so the running
-- release keeps working against this schema.
-- "Institution"."nameRu", "formerName": Russian name and the name before the 2025 renaming; "searchText": normalized
-- name + Russian name + former name for «contains» search; "districtName": district as written in the list, until
-- the districts' SOATO codes are loaded.
-- "Region"."slug": the web app's region id (UZ_REGIONS); filled by prisma/seed-registry.ts and the technikum import.

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "districtName" TEXT,
ADD COLUMN     "formerName" TEXT,
ADD COLUMN     "nameRu" TEXT,
ADD COLUMN     "searchText" TEXT;

-- AlterTable
ALTER TABLE "Region" ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Region_tenantId_slug_key" ON "Region"("tenantId", "slug");
