/**
 * Registry reference data (industries, regions) for an existing tenant. Safe on production and repeatable.
 *
 *   npm run prisma:seed:registry -w apps/api
 *   on the server: sh /opt/ilmora/infra/uzcloud/compose.sh admin --profile migrate run --rm migrate npx tsx prisma/seed-registry.ts
 *
 * The main seed (prisma/seed.ts) runs the same step, so a fresh database gets it too.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { seedRegistryReference } from './registry-reference'

try {
  process.loadEnvFile?.('.env')
} catch {
  /* env from the process */
}

const DATABASE_URL = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'ilmora'

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } })
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" does not exist: run prisma/seed.ts first`)
  const done = await seedRegistryReference(prisma, tenant.id)
  console.log(`Registry reference data: ${done.industries} industries, ${done.regions} regions (existing rows kept as they are)`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
