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
 * Rule: the import never writes a course that is not one of the platform's online courses — the row of a center's
 * course (another centerId, OFFLINE) stays exactly as it was, every column, updatedAt included. How the fix does it is
 * open (match by the stable id, or skip or stop on such a slug). A run that finishes is accepted, and so is a stop on
 * this collision only: a P2002 on (tenantId, slug), or a message naming the slug as «not a platform course». The
 * colliding course is the last of the list, so in both cases the other courses must have been refreshed first; a fix
 * that checks every slug before writing anything has to adjust that sanity check.
 *
 * The script calls main() on import, so it is run as it is in production: a child process (tsx) against the test
 * database, for one fresh tenant (DEFAULT_TENANT_SLUG). Everything else it would look up is created first — the platform
 * center and profile, the categories, and the other online courses under their stable ids — so it creates nothing with
 * a fixed id and a second run does not collide; those courses are deleted afterwards.
 *
 * KNOWN_GAP pins today's exact state: the center's course becomes the platform's (ILMORA Online center, ONLINE, the
 * provider's link, price 0). When the import stops doing that, the check fails with «remove 'n11' from KNOWN_GAP» —
 * then remove it and the rule is demanded from then on. Any other change of today's outcome fails as «re-evaluate».
 */
const KNOWN_GAP = new Set(['n11'])
const checked = new Set<string>()
function rule(key: string, holds: boolean, what: string, todayObserved: boolean) {
  checked.add(key)
  if (KNOWN_GAP.has(key)) {
    expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
    expect(todayObserved, `${what} — the outcome is no longer today's known one: re-evaluate '${key}'`).toBe(true)
  } else expect(holds, what).toBe(true)
}

const API = join(__dirname, '..')
const SCRIPT = join(API, 'prisma/seed-online-courses.ts')
const REUSED_CATEGORIES = ['english', 'math', 'it', 'sciences']

describe.skipIf(!DB_AVAILABLE)('№11 online catalog import leaves a center\'s own course with the same slug alone', () => {
  const ctx = new TestContext()
  // The last one: the import walks the list in order, so every other course is refreshed before it reaches the collision.
  const victimSeed = ONLINE_COURSES.at(-1)!
  const others = ONLINE_COURSES.slice(0, -1)

  beforeAll(() => ctx.connect())
  afterAll(async () => {
    await TenantContext.system(() => ctx.prisma.client.course.deleteMany({ where: { id: { in: ONLINE_COURSES.map((c) => c.id) }, tenant: { slug: { startsWith: 'imp-' } } }, hardDelete: true } as never))
    await ctx.close()
    for (const key of KNOWN_GAP) expect(checked.has(key), `'${key}' in KNOWN_GAP was never checked`).toBe(true)
  })

  it('a run of the import does not turn the center\'s course into the platform\'s online course', async () => {
    const db = ctx.prisma.client
    // The stable ids must be free outside this test's tenants (a seeded database would collide on the primary key).
    const foreign = await TenantContext.system(() => db.course.findMany({ where: { id: { in: ONLINE_COURSES.map((c) => c.id) }, NOT: { tenant: { slug: { startsWith: 'imp-' } } } }, select: { id: true, tenantId: true }, includeDeleted: true } as never)) as { id: string; tenantId: string }[]
    expect(foreign, `the online catalog ids are already used outside imp-* tenants (seeded test database?): ${foreign.map((c) => `${c.id}@${c.tenantId}`).join(', ')}`).toEqual([])
    // Leftovers of an interrupted earlier run would hold the stable ids.
    await TenantContext.system(() => db.course.deleteMany({ where: { id: { in: ONLINE_COURSES.map((c) => c.id) }, tenant: { slug: { startsWith: 'imp-' } } }, hardDelete: true } as never))
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

    // The center's own course that happens to use the last online slug.
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

    // Setup sanity, outside the rule: the script really ran against this tenant and refreshed the platform's own courses
    // (the provider link is filled in) — whether it then finished, or stopped on the colliding course at the end of the list.
    expect(run.error, output).toBeUndefined()
    if (run.status === 0) {
      expect(output, output).toContain(`tenant "${tenant.slug}"`)
    } else {
      // A stop is accepted only on this collision: the (tenantId, slug) uniqueness, or a dedicated message (stack lines
      // aside) naming the slug as not the platform's course. A failed connection or any other error is not a stop.
      const message = (run.stderr ?? '').split('\n').filter((l) => !/^\s+at /.test(l)).join('\n')
      const dedicated = message.includes(victimSeed.slug) && /not (a|the) platform('s)? (online )?course/i.test(message)
      const unique = /P2002|Unique constraint failed/.test(output) && !/PrismaClientInitializationError|ECONNREFUSED|not found/i.test(output)
      expect(dedicated || unique, `the import failed for another reason:\n${output}`).toBe(true)
    }
    const refreshed = await TenantContext.system(() => db.course.findMany({ where: { tenantId: t.tenantId, id: { in: others.map((c) => c.id) } }, select: { id: true, externalUrl: true, centerId: true } }))
    expect(refreshed).toHaveLength(others.length)
    for (const c of refreshed) {
      expect(c.externalUrl, `${c.id} was not refreshed:\n${output}`).toBe(others.find((o) => o.id === c.id)!.url)
      expect(c.centerId, c.id).toBe(platformCenter.id)
    }

    // The whole row, every column (BigInt as text, see test/setup.ts), updatedAt included: untouched means not written.
    const after = await TenantContext.system(() => db.course.findUniqueOrThrow({ where: { id: own.id } }))
    const changed = (Object.keys(own) as (keyof typeof own)[]).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(own[k]))
    const untouched = changed.length === 0 && Object.keys(after).length === Object.keys(own).length
    // Today: the course is taken over by the platform.
    const takenOver = after.centerId === platformCenter.id && after.learningFormat === 'ONLINE' && after.externalUrl === victimSeed.url && after.priceMinor === 0n
    rule('n11', untouched, `the center's course "${victimSeed.slug}" is not written by the import (now changed: ${changed.join(', ') || 'nothing'})`, takenOver)
  }, 180_000)
})
