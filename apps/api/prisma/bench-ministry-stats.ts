/**
 * Timing of the ministry's figures (ТЗ 7.3, check «600+ учреждений и 10 000 студентов: дашборд меньше 2 секунд»).
 * Read-only: runs every table and the whole dashboard with a few filters and prints the times. Not for production data
 * in working hours — it reads everything the dashboard reads, several times.
 *
 *   DATABASE_URL=… npx tsx prisma/bench-ministry-stats.ts            # 5 runs of each
 *   BENCH_RUNS=20 DATABASE_URL=… npx tsx prisma/bench-ministry-stats.ts
 */
import { MINISTRY_TABLES, type MinistryStatsFilters } from '@ilmora/shared'
import type { Env } from '../src/config/env'
import { PrismaService } from '../src/infra/prisma/prisma.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { MinistryStatsService } from '../src/modules/ministry/ministry-stats.service'

try {
  process.loadEnvFile?.('.env')
} catch {
  /* env from the process */
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')
const RUNS = Number(process.env.BENCH_RUNS ?? 5)
const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'ilmora'
const prisma = new PrismaService({ DATABASE_URL, DATABASE_POOL_MAX: 10, NODE_ENV: 'production' } as Env)
const stats = new MinistryStatsService(prisma)

const ms = (t: bigint) => Number(process.hrtime.bigint() - t) / 1e6
async function time(fn: () => Promise<unknown>): Promise<{ median: number; max: number }> {
  const all: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint()
    await fn()
    all.push(ms(t))
  }
  all.sort((a, b) => a - b)
  return { median: all[Math.floor(all.length / 2)], max: all[all.length - 1] }
}

async function main() {
  const tenant = await TenantContext.system(() => prisma.client.tenant.findUnique({ where: { slug: TENANT_SLUG } }))
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" does not exist`)
  await TenantContext.forTenant(tenant.id, async () => {
    const counts = {
      institutions: await prisma.client.institution.count(),
      approved: await prisma.client.institution.count({ where: { approvedAt: { not: null } } }),
      students: await prisma.client.studentProfile.count(),
      companies: await prisma.client.company.count(),
    }
    console.log(`data: ${counts.institutions} institutions (${counts.approved} approved), ${counts.students} students, ${counts.companies} companies; ${RUNS} runs each\n`)
    const region = await prisma.client.region.findFirst({ where: { slug: 'tashkent' }, select: { id: true } })
    const filters: [string, MinistryStatsFilters][] = [
      ['no filter', {}],
      ['region', { regionId: region?.id }],
      ['type + ownership', { type: 'TECHNIKUM', ownership: 'STATE' }],
      ['year', { year: 2027 }],
    ]
    await stats.all({}) // warm-up: connections, plans
    for (const [name, f] of filters) {
      const r = await time(() => stats.all(f))
      console.log(`dashboard, ${name.padEnd(17)} median ${r.median.toFixed(0).padStart(5)} ms   max ${r.max.toFixed(0).padStart(5)} ms`)
    }
    console.log('')
    for (const key of MINISTRY_TABLES) {
      const r = await time(() => stats.one(key, {}))
      console.log(`${key.padEnd(24)} median ${r.median.toFixed(0).padStart(5)} ms   max ${r.max.toFixed(0).padStart(5)} ms`)
    }
  })
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.client.$disconnect())
