import { REGISTRY_DISTRICTS, REGISTRY_INDUSTRIES, REGISTRY_REGIONS } from '@ilmora/shared'
import type { Prisma, PrismaClient } from '../src/generated/prisma/client'

/**
 * Reference data of the ministry registry: the industries and the 14 regions (SOATO codes). Idempotent: rows are keyed
 * by slug / code, and an existing row is left as it is, so names the Super Admin edited are never overwritten.
 * Districts are a separate step (seedRegistryDistricts): once a region has districts, an institution's passport needs one.
 */
export async function seedRegistryReference(prisma: PrismaClient, tenantId: string) {
  for (const [i, industry] of REGISTRY_INDUSTRIES.entries()) {
    await prisma.industry.upsert({
      where: { tenantId_slug: { tenantId, slug: industry.slug } },
      update: {},
      create: { tenantId, slug: industry.slug, name: industry.name as Prisma.InputJsonValue, sortOrder: i },
    })
  }
  for (const [i, region] of REGISTRY_REGIONS.entries()) {
    // The slug links the region to the web app's ids; filling it in never touches a name the Super Admin edited.
    await prisma.region.upsert({
      where: { tenantId_code: { tenantId, code: region.code } },
      update: { slug: region.slug },
      create: { tenantId, code: region.code, slug: region.slug, name: region.name as Prisma.InputJsonValue, sortOrder: i },
    })
  }
  return { industries: REGISTRY_INDUSTRIES.length, regions: REGISTRY_REGIONS.length }
}

/**
 * The 206 districts with their SOATO codes (REGISTRY_DISTRICTS: the Statistics Agency's open data). Run after
 * seedRegistryReference (the regions must exist). Idempotent: a district already there is left as it is, never renamed
 * or moved. Returns how many were added.
 */
export async function seedRegistryDistricts(prisma: PrismaClient, tenantId: string) {
  const regions = await prisma.region.findMany({ where: { tenantId }, select: { id: true, code: true } })
  const regionIdByCode = new Map(regions.map((r) => [r.code, r.id]))
  const missing = [...new Set(REGISTRY_DISTRICTS.map((d) => d.region))].filter((code) => !regionIdByCode.has(code))
  if (missing.length) throw new Error(`Regions ${missing.join(', ')} are not in the database: run seedRegistryReference first`)
  const { count } = await prisma.district.createMany({
    data: REGISTRY_DISTRICTS.map((d) => ({ tenantId, regionId: regionIdByCode.get(d.region)!, code: d.code, name: d.name as Prisma.InputJsonValue })),
    skipDuplicates: true,
  })
  return { districts: REGISTRY_DISTRICTS.length, added: count }
}
