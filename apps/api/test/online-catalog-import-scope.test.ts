import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { ONLINE_CATEGORIES, ONLINE_COURSES } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { ONLINE_PROVIDER } from '../src/modules/manage/online-provider'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * Security check 20.11 (note «2026-11-20 Проверка безопасности ILMORA»), finding №11: the online catalog import
 * (apps/api/prisma/seed-online-courses.ts) finds an existing course by slug alone and overwrites it with the platform's
 * facts — the «ILMORA Online» center and profile, ONLINE, the provider's link, price 0. A center whose own course
 * happens to use a slug from packages/shared/src/online-courses.ts loses it to the platform on the next deploy.
 *
 * Rule: the import never changes a course that is not one of the platform's online courses — one of a center (another
 * centerId, OFFLINE) keeps its center, teacher, format, link and price. How the fix does it is open (match by the stable
 * id, or skip or stop on such a slug); both a run that finishes and a run that stops with the slug named are accepted.
 *
 * The script calls main() on import, so it is run as it is in production: a child process (tsx) against the test
 * database, for one fresh tenant (DEFAULT_TENANT_SLUG). Everything else it would look up is created first — the platform
 * center and profile, the categories, and the other online courses under their stable ids — so it creates nothing with
 * a fixed id and a second run does not collide; those courses are deleted afterwards.
 *
 * KNOWN_GAP pins today's state: the center's course is overwritten. When the import stops doing that, the check fails
 * with «remove 'n11' from KNOWN_GAP» — then remove it and the rule is demanded from then on.
 */
const KNOWN_GAP = new Set(['n11'])
function rule(key: string, holds: boolean, what: string) {
  if (KNOWN_GAP.has(key)) expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
  else expect(holds, what).toBe(true)
}

const API = join(__dirname, '..')
const SCRIPT = join(API, 'prisma/seed-online-courses.ts')
const REUSED_CATEGORIES = ['english', 'math', 'it', 'sciences']

describe.skipIf(!DB_AVAILABLE)('№11 online catalog import leaves a center\'s own course with the same slug alone', () => {
  const ctx = new TestContext()
  const victimSeed = ONLINE_COURSES[0]
  const others = ONLINE_COURSES.slice(1)

  beforeAll(() => ctx.connect())
  afterAll(async () => {
    await TenantContext.system(() => ctx.prisma.client.course.deleteMany({ where: { id: { in: ONLINE_COURSES.map((c) => c.id) }, tenant: { slug: { startsWith: 'imp-' } } } }))
    await ctx.close()
  })

  it('a run of the import does not turn the center\'s course into the platform\'s online course', async () => {
    const db = ctx.prisma.client
    // Leftovers of an interrupted earlier run would hold the stable ids.
    await TenantContext.system(() => db.course.deleteMany({ where: { id: { in: ONLINE_COURSES.map((c) => c.id) }, tenant: { slug: { startsWith: 'imp-' } } } }))
    const t = await ctx.makeTenant('imp')
    const tenant = await TenantContext.system(() => db.tenant.findUniqueOrThrow({ where: { id: t.tenantId } }))

    // The world the import expects: the platform center/profile, every category, every other online course (stable id).
    const { platformCenter } = await TenantContext.system(async () => {
      const platformCenter = await db.center.create({ data: { tenantId: t.tenantId, slug: ONLINE_PROVIDER.slug, name: ONLINE_PROVIDER.name, district: ONLINE_PROVIDER.district, description: ONLINE_PROVIDER.description } })
      const platformTeacher = await db.teacherProfile.create({ data: { tenantId: t.tenantId, slug: ONLINE_PROVIDER.slug, name: ONLINE_PROVIDER.name, title: {}, bio: {}, tagline: {}, centerId: platformCenter.id, channelActive: false } })
      const categoryId = new Map<string, string>()
      for (const slug of [...ONLINE_CATEGORIES.map((c) => c.slug), ...REUSED_CATEGORIES]) {
        categoryId.set(slug, (await db.category.create({ data: { tenantId: t.tenantId, slug, name: {} } })).id)
      }
      for (const c of others) {
        await db.course.create({ data: { id: c.id, tenantId: t.tenantId, slug: c.slug, title: {}, categoryId: categoryId.get(c.category)!, centerId: platformCenter.id, teacherId: platformTeacher.id, summary: {}, description: {}, curriculum: [], learningFormat: 'ONLINE', priceMinor: 0n, status: 'PUBLISHED', visibility: 'PUBLIC' } })
      }
      return { platformCenter }
    })

    // The center's own course that happens to use the first online slug.
    const own = await TenantContext.system(() => db.course.create({ data: { tenantId: t.tenantId, slug: victimSeed.slug, title: { uz: 'Markaz kursi', ru: 'Курс центра', en: 'Center course' }, categoryId: t.category.id, centerId: t.center.id, teacherId: t.teacher.id, summary: {}, description: {}, curriculum: [], priceMinor: 70_000_00n, status: 'PUBLISHED', visibility: 'PUBLIC' } }))
    expect(own.learningFormat).toBe('OFFLINE')
    expect(own.id).not.toBe(victimSeed.id)

    const url = process.env.DATABASE_URL!
    const tsxCli = createRequire(join(API, 'package.json')).resolve('tsx/cli')
    const run = spawnSync(process.execPath, [tsxCli, SCRIPT], {
      cwd: API,
      env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATE_URL: url, DEFAULT_TENANT_SLUG: tenant.slug },
      encoding: 'utf8',
      timeout: 120_000,
    })
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`

    // Setup sanity, outside the rule: the script really ran against this tenant. Either it finished and refreshed the
    // platform's own courses (the provider link is filled in), or it stopped on the colliding slug and said which.
    expect(run.error, output).toBeUndefined()
    if (run.status === 0) {
      expect(output, output).toContain(`tenant "${tenant.slug}"`)
      const refreshed = await TenantContext.system(() => db.course.findMany({ where: { tenantId: t.tenantId, id: { in: others.map((c) => c.id) } }, select: { id: true, externalUrl: true, centerId: true } }))
      expect(refreshed).toHaveLength(others.length)
      for (const c of refreshed) {
        expect(c.externalUrl, c.id).toBe(others.find((o) => o.id === c.id)!.url)
        expect(c.centerId, c.id).toBe(platformCenter.id)
      }
    } else {
      // Stopping is accepted only on this collision: the slug named, or the (tenantId, slug) uniqueness it runs into.
      expect(output.includes(victimSeed.slug) || /P2002|Unique constraint failed/.test(output), `the import failed for another reason:\n${output}`).toBe(true)
    }

    const after = await TenantContext.system(() => db.course.findUniqueOrThrow({ where: { id: own.id } }))
    const untouched = after.centerId === t.center.id && after.teacherId === t.teacher.id && after.learningFormat === 'OFFLINE'
      && after.priceMinor === own.priceMinor && after.externalUrl === null && after.providerName === null
      && JSON.stringify(after.title) === JSON.stringify(own.title)
    rule('n11', untouched, `the center's course "${victimSeed.slug}" keeps its center, teacher, OFFLINE format, price and title after the import (now: center ${after.centerId === platformCenter.id ? 'ILMORA Online' : after.centerId}, ${after.learningFormat}, ${after.priceMinor} tiyin)`)
  }, 180_000)
})
