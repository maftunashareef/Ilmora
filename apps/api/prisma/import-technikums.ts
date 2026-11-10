/**
 * The official technikum list (738 institutions, stat.edu.uz, 9 Nov 2026) into the registry. Safe on production and
 * repeatable; without --apply it only prints what it would do.
 *
 *   npm run prisma:import:technikums -w apps/api              # report only
 *   npm run prisma:import:technikums -w apps/api -- --apply   # write
 *   on the server: sh /opt/ilmora/infra/uzcloud/compose.sh admin --profile migrate run --rm migrate npx tsx prisma/import-technikums.ts [--apply]
 *
 * With --apply it first fills the reference data (industries, regions with their slugs), as prisma/seed-registry.ts does.
 * Rules: prisma/registry-import.ts and docs/registry/data-model.md.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { importTechnikums } from './registry-import'
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
const apply = process.argv.includes('--apply')

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } })
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" does not exist: run prisma/seed.ts first`)
  if (apply) await seedRegistryReference(prisma, tenant.id)

  const r = await importTechnikums(prisma, tenant.id, { apply })
  console.log(apply ? '== technikum import: written' : '== technikum import: report only (add --apply to write)')
  console.log(`list ${r.total}: new ${r.created.length}, updated ${r.updated.length}, enriched ${r.enriched.length}, unchanged ${r.unchanged}`)
  if (r.missingRegion.length) console.log(`no region in the database for ${r.missingRegion.length} (run prisma/seed-registry.ts): ${r.missingRegion.join(', ')}`)
  if (r.stirConflicts.length) {
    console.log(`\nSTIR already held by another record — not written, merge by hand (${r.stirConflicts.length}):`)
    for (const c of r.stirConflicts) console.log(`  ${c.id} «${c.name}» STIR ${c.stir} → held by ${c.holder.id} «${c.holder.name}» (${c.holder.source}, ${c.holder.status})`)
  }
  if (r.sameName.length) {
    console.log(`\nSame name in the same region as an existing record — created, merge the other one later (${r.sameName.length}):`)
    for (const c of r.sameName) console.log(`  ${c.id} «${c.name}» ↔ ${c.holder.id} (${c.holder.source}, ${c.holder.status})`)
  }
  if (r.notInList.length) {
    console.log(`\nImported earlier, no longer in the list — kept (${r.notInList.length}):`)
    for (const c of r.notInList) console.log(`  ${c.id} «${c.name}»`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
