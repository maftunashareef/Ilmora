import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { keysIn, MEDIA_PREFIXES, MediaSweepService, planSweep, type MediaObject, type MediaStore } from '../src/infra/storage/media-sweep.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * Abandoned files in the public media bucket (security review 19.11, №10; src/infra/storage/media-sweep.service.ts):
 * a file older than the minimum age that no row mentions is abandoned; deleting is off by default and refuses when the
 * references look broken. A file any row mentions — the audit log included — is kept.
 */
const DAY = 86_400_000
const now = new Date('2026-11-21T00:00:00Z')
const obj = (key: string, daysOld: number, size = 1000): MediaObject => ({ key, size, lastModified: new Date(now.getTime() - daysOld * DAY) })

describe('media sweep: what counts as abandoned', () => {
  it('finds media keys inside stored addresses and JSON, without a trailing dot', () => {
    const url = 'https://s3.uzcstorage.uz/ilmora-media/courses/t1/p1-1763000000000-ab12cd34.jpg'
    expect(keysIn(url)).toEqual(['courses/t1/p1-1763000000000-ab12cd34.jpg'])
    expect(keysIn(JSON.stringify({ hero: { image: '/banners/t1/p1-1.webp' }, logo: 'universities/t1/logo-2.png' }))).toEqual(['banners/t1/p1-1.webp', 'universities/t1/logo-2.png'])
    expect(keysIn('see avatars/t1/u1-5.png.')).toEqual(['avatars/t1/u1-5.png'])
    expect(keysIn('docs/t1/passport.pdf and incoming/x.pdf')).toEqual([])
  })

  it('takes only old files nobody mentions', () => {
    const plan = planSweep([obj('courses/a.jpg', 40), obj('courses/b.jpg', 40), obj('courses/new.jpg', 2), obj('banners/c.png', 90, 5000)], new Set(['courses/a.jpg', 'x']), now, 30)
    expect(plan.old).toBe(3)
    expect(plan.abandoned.map((o) => o.key)).toEqual(['courses/b.jpg', 'banners/c.png'])
    expect(plan.abandonedBytes).toBe(6000)
  })

  it('refuses to delete when the references look broken', () => {
    expect(planSweep([obj('courses/a.jpg', 40)], new Set(), now, 30).refuse).toMatch(/no references/)
    const many = Array.from({ length: 10 }, (_, i) => obj(`courses/${i}.jpg`, 40))
    expect(planSweep(many, new Set(['courses/0.jpg', 'courses/1.jpg', 'courses/2.jpg']), now, 30).refuse).toMatch(/7 of 10/)
    expect(planSweep(many, new Set(many.slice(0, 6).map((o) => o.key)), now, 30).refuse).toBeNull()
  })

  it('sweeps only the upload areas of the studio', () => {
    expect(MEDIA_PREFIXES).toEqual(['courses/', 'thumbnails/', 'banners/', 'resources/', 'avatars/', 'universities/'])
  })
})

describe.skipIf(!DB_AVAILABLE)('media sweep: references in the database', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /** A bucket in memory: what the sweep lists and what it deletes. */
  class Store implements MediaStore {
    removed: string[] = []
    constructor(private readonly objects: MediaObject[]) {}
    async list(prefix: string) {
      return this.objects.filter((o) => o.key.startsWith(prefix))
    }
    async remove(keys: string[]) {
      this.removed.push(...keys)
    }
  }

  it('keeps every file a row mentions — a column, JSON, the audit log — and deletes the rest only when switched on', async () => {
    const t = await ctx.makeTenant('sweep')
    const db = ctx.prisma.client
    const id = t.tenantId
    const inCourse = `courses/${id}/p1-1-aa.jpg`
    const inSite = `banners/${id}/p1-2-bb.webp`
    const inAudit = `thumbnails/${id}/p1-3-cc.png`
    const lost = `resources/${id}/p1-4-dd.pdf`
    await TenantContext.system(async () => {
      await db.course.update({ where: { id: t.course.id }, data: { imageUrl: `https://s3.uzcstorage.uz/ilmora-media/${inCourse}` } })
      await db.siteConfig.update({ where: { tenantId: id }, data: { data: { permissions: {}, media: { hero: `/${inSite}` } } } })
      await db.auditEvent.create({ data: { tenantId: id, action: 'video.update', entityType: 'Video', entityId: 'v1', before: { thumbnailUrl: inAudit } } })
    })
    const objects = [obj(inCourse, 60), obj(inSite, 60), obj(inAudit, 60), obj(lost, 60), obj(`resources/${id}/fresh.pdf`, 1)]

    const found = await TenantContext.system(() => new MediaSweepService(ctx.prisma, ctx.env).referencedKeys())
    expect([inCourse, inSite, inAudit].every((k) => found.has(k))).toBe(true)
    expect(found.has(lost)).toBe(false)

    // Report only by default: nothing deleted.
    const report = new Store(objects)
    const r1 = await TenantContext.system(() => new MediaSweepService(ctx.prisma, { ...ctx.env, MEDIA_SWEEP_DELETE: false, MEDIA_SWEEP_MIN_AGE_DAYS: 30 }).run(report, now))
    expect(r1).toMatchObject({ mode: 'report', abandoned: 1, deleted: 0, refused: null })
    expect(report.removed).toEqual([])

    // Switched on: only the old file nobody mentions goes.
    const live = new Store(objects)
    const r2 = await TenantContext.system(() => new MediaSweepService(ctx.prisma, { ...ctx.env, MEDIA_SWEEP_DELETE: true, MEDIA_SWEEP_MIN_AGE_DAYS: 30 }).run(live, now))
    expect(r2).toMatchObject({ mode: 'delete', abandoned: 1, deleted: 1 })
    expect(live.removed).toEqual([lost])
  })
})
