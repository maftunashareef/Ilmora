import { REGISTRY_INDUSTRIES, REGISTRY_REGIONS } from '@ilmora/shared'
import type { Prisma, PrismaClient } from '../src/generated/prisma/client'

/**
 * Reference data of the ministry registry: the industries and the 14 regions (SOATO codes). Idempotent: rows are keyed
 * by slug / code, and an existing row is left as it is, so names the Super Admin edited are never overwritten.
 * Districts are not here: they come only from an official list (the ministry's registry file or stat.uz).
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
