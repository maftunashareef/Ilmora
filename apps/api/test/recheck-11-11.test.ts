import 'reflect-metadata'
import { courseSaveBody, groupSaveBody, sampleData, type Course } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays, isoToDateColumn, zonedTimeToUtc } from '../src/common/time'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import { toCourse } from '../src/modules/catalog/catalog.service'
import { ManageService } from '../src/modules/manage/manage.service'
import { SiteService } from '../src/modules/site/site.service'
import { notificationsStub } from './stubs'
import { SessionsProcessor } from '../src/modules/sessions/sessions.processor'
import { SessionsService } from '../src/modules/sessions/sessions.service'
import { TenantsService } from '../src/modules/tenants/tenants.service'
import { RENEW_WINDOW_DAYS } from '../src/modules/enrollment/subscription.service'
import { DB_AVAILABLE, TestContext } from './helpers'

const DAY = 86_400_000

/** Sherzod's re-check of 11.11 («Доработки Ilmora»): Н6 (№80), Н7 (№100), Н13, Н18, Н1 — each with its guard. */
describe.skipIf(!DB_AVAILABLE)('Re-check 11.11: payments', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /** A student with a paid Duo subscription whose month ends in a few days (renewal window open). */
  const paidNearEnd = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const student = await ctx.makeStudent(t.tenantId)
    const { payment, subscription } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    await inT(() => ctx.payments.manualSettle(payment.id, student.id, 'test'))
    const end = new Date(Date.now() + (RENEW_WINDOW_DAYS - 2) * DAY)
    await inT(async () => {
      await db.subscription.update({ where: { id: subscription.id }, data: { currentPeriodEnd: end } })
      await db.payment.update({ where: { id: payment.id }, data: { periodEnd: end } })
    })
    return { ...t, student, payment, subscription, inT }
  }

  it('Н6 / №80: «Продлить» pressed five times at once makes one invoice — every press gets it', async () => {
    const s = await paidNearEnd('rc-renew')
    const results = await s.inT(() => Promise.all(Array.from({ length: 5 }, () => ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME'))))
    expect(new Set(results.map((r) => r.payment.id)).size).toBe(1)
    expect(await s.inT(() => db.payment.count({ where: { subscriptionId: s.subscription.id, state: 'PENDING' } }))).toBe(1)
  })

  it('Н6: two checkouts of one cart at once make one invoice', async () => {
    const t = await ctx.makeTenant('rc-checkout')
    const student = await ctx.makeStudent(t.tenantId)
    await TenantContext.forTenant(t.tenantId, () => ctx.subscriptions.saveDraft(t.tenantId, student.id, { packageId: t.pkg.id, groupIds: [t.group.id, t.group2.id], meyosGrant: false }))
    const results = await TenantContext.forTenant(t.tenantId, () => Promise.allSettled([ctx.subscriptions.checkout(t.tenantId, student.id, 'PAYME'), ctx.subscriptions.checkout(t.tenantId, student.id, 'PAYME')]))
    // Both presses answer (the second used to fail with a 500 on the seat holds), with the same invoice.
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ payment: { id: string } }>[]
    expect(ok).toHaveLength(2)
    expect(new Set(ok.map((r) => r.value.payment.id)).size).toBe(1)
    expect(await TenantContext.forTenant(t.tenantId, () => db.payment.count({ where: { studentId: student.id } }))).toBe(1)
  })

  it('Н6: an invoice for a month another paid invoice covers is not paid — the provider is refused, whatever made it', async () => {
    const s = await paidNearEnd('rc-period')
    await s.inT(async () => {
      // A second invoice for the same month (made by a path that has no lock — the guard does not depend on how).
      const twin = await db.payment.create({ data: { tenantId: s.tenantId, studentId: s.student.id, subscriptionId: s.subscription.id, periodStart: s.payment.periodStart, periodEnd: s.payment.periodEnd, amountMinor: s.payment.amountMinor, currency: 'UZS', provider: 'PAYME', expiresAt: new Date(Date.now() + 3_600_000) } })
      expect(await ctx.payments.settleBlocker(db, twin)).toBe('period_already_paid')
      // The next month is fine.
      const { payment: next } = await ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')
      expect(next.id).toBe(twin.id) // the waiting invoice is returned, not a third one
      await db.payment.update({ where: { id: twin.id }, data: { state: 'CANCELLED' } })
      const { payment: renewal } = await ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')
      expect(await ctx.payments.settleBlocker(db, renewal)).toBeNull()
    })
  })
})

describe.skipIf(!DB_AVAILABLE)('Re-check 11.11: Н13 — a daily run interrupted by a restart is not lost', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())
  type Runner = { runOnce: (q: string, k: string, fn: () => Promise<unknown>) => Promise<unknown>; queueReminders: () => Promise<{ queued: number }> }
  const make = (redis: object, extra: Partial<Record<'sessions' | 'tenants' | 'sms', unknown>> = {}) =>
    new SessionsProcessor((extra.sessions ?? {}) as never, ctx.prisma, (extra.tenants ?? {}) as never, (extra.sms ?? {}) as never, {} as never, {} as never, ctx.env, redis as never) as unknown as Runner
  const row = (key: string, workerId: string, startedAt = new Date()) => TenantContext.system(() => db.jobRun.create({ data: { queue: 'sessions', jobKey: key, workerId, startedAt } }))

  it('a «running» row of a worker that is gone (killed by a deploy) is taken over at once, not skipped', async () => {
    const key = `daily-gone-${Date.now()}`
    await row(key, 'old-container:1:deadbeef')
    expect(await make({ off: true }).runOnce('sessions', key, async () => ({ ran: true }))).toEqual({ ran: true })
    // With Redis: the worker has no «alive» mark — taken over too.
    const key2 = `daily-gone2-${Date.now()}`
    await row(key2, 'old-container:1:cafe0000')
    expect(await make({ off: false, cache: { exists: async () => 0, set: async () => 'OK', del: async () => 1 } }).runOnce('sessions', key2, async () => ({ ran: true }))).toEqual({ ran: true })
  })

  it('a run a live worker is executing is left to it; this process does not run its own key twice', async () => {
    const key = `daily-live-${Date.now()}`
    await row(key, 'other-container:1:aaaa1111')
    expect(await make({ off: false, cache: { exists: async () => 1 } }).runOnce('sessions', key, async () => ({ ran: true }))).toEqual({ skipped: true })
    const me = make({ off: true })
    const key2 = `daily-self-${Date.now()}`
    let release!: () => void
    const first = me.runOnce('sessions', key2, () => new Promise((r) => { release = () => r({ ran: 1 }) }))
    await new Promise((r) => setTimeout(r, 50))
    expect(await me.runOnce('sessions', key2, async () => ({ ran: 2 }))).toEqual({ skipped: true })
    release()
    expect(await first).toEqual({ ran: 1 })
  })

  it('reminders queued again after a takeover do not text anyone twice', async () => {
    const t = await ctx.makeTenant('rc-remind')
    const student = await ctx.makeStudent(t.tenantId)
    const { payment } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    await TenantContext.forTenant(t.tenantId, () => ctx.payments.manualSettle(payment.id, student.id, 'test'))
    const tenants = new TenantsService(ctx.prisma, ctx.env)
    const sessions = new SessionsService(ctx.prisma, tenants, ctx.env)
    const tomorrow = addDays(sessions.todayLocal(), 1)
    await TenantContext.forTenant(t.tenantId, async () => {
      for (const g of [t.group, t.group2]) await db.lessonSession.create({ data: { tenantId: t.tenantId, groupId: g.id, courseId: g.courseId, date: isoToDateColumn(tomorrow), startsAt: zonedTimeToUtc(tomorrow, '18:00', 'Asia/Tashkent'), endsAt: zonedTimeToUtc(tomorrow, '19:30', 'Asia/Tashkent'), status: 'SCHEDULED' } })
    })
    const texts: string[] = []
    const sms = { enqueue: async (m: { tenantId: string; phoneE164: string; templateKey: string }) => { texts.push(m.phoneE164); await TenantContext.system(() => db.smsMessage.create({ data: { tenantId: m.tenantId, phoneE164: m.phoneE164, templateKey: m.templateKey } })); return 'x' } }
    const runner = make({ off: true }, { sessions, tenants: { listIds: async () => [t.tenantId] }, sms })
    expect((await runner.queueReminders()).queued).toBe(2) // two lessons tomorrow — two texts
    expect((await runner.queueReminders()).queued).toBe(0) // the run taken over: nothing again
    expect(texts).toHaveLength(2)
  })
})

describe.skipIf(!DB_AVAILABLE)('Re-check 11.11: Н1 — a teacher saves a course the way the site sends it; Н18 — one site save of two', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('Н1: the site body of an unchanged course and its groups saves for a teacher; only a real price change is refused', async () => {
    const t = await ctx.makeTenant('rc-teacher')
    const site = new SiteService(ctx.prisma, ctx.audit)
    const manage = new ManageService(ctx.prisma, ctx.audit, { generateForGroup: async () => 0, todayLocal: () => '2026-11-11' } as unknown as SessionsService, site, notificationsStub, ctx.env)
    await TenantContext.system(() => db.center.update({ where: { id: t.center.id }, data: { status: 'ACTIVE' } }))
    const teacher: RequestActor = { id: t.teacherUser.id, roles: ['TEACHER'], centerId: null, teacherProfileId: t.teacher.id }
    await TenantContext.forTenant(t.tenantId, async () => {
      // The course as the site holds it (the API's own course DTO), with a discount the teacher may not change.
      await db.course.update({ where: { id: t.course.id }, data: { discountPercent: 10, discountStartsAt: new Date(Date.now() - 86_400_000), discountEndsAt: new Date(Date.now() + 86_400_000) } })
      const row = await db.course.findUniqueOrThrow({ where: { id: t.course.id }, include: { groups: { where: { deletedAt: null } } } })
      const course = toCourse(row) as unknown as Course
      // Exactly what the site sends (courseSaveBody / groupSaveBody from @ilmora/shared, used by the web store).
      expect(await manage.updateCourse(t.tenantId, teacher, course.id, courseSaveBody(course) as never)).toMatchObject({ id: course.id })
      expect(await manage.updateCourse(t.tenantId, teacher, course.id, courseSaveBody({ ...course, description: { uz: 'Yangi', ru: 'Новое', en: 'New' } }) as never)).toMatchObject({ description: { ru: 'Новое' } })
      for (const g of course.groups) expect(await manage.updateGroup(t.tenantId, teacher, g.id, groupSaveBody(g) as never)).toBeTruthy()
      await expect(manage.updateCourse(t.tenantId, teacher, course.id, courseSaveBody({ ...course, price: course.price + 1000 }) as never)).rejects.toMatchObject({ details: undefined, message: expect.stringContaining('Price') })
    })
  })

  it('Н18: two saves of the site settings made from one version at once — one is written, the other gets version_conflict', async () => {
    const t = await ctx.makeTenant('rc-site')
    const site = new SiteService(ctx.prisma, ctx.audit)
    const { packages: _p, ...data } = sampleData.site
    void _p
    await TenantContext.forTenant(t.tenantId, async () => {
      const { version } = await site.update(t.tenantId, data, 1)
      const results = await Promise.allSettled([site.update(t.tenantId, { ...data, brand: { ...data.brand, name: 'A' } }, version), site.update(t.tenantId, { ...data, brand: { ...data.brand, name: 'B' } }, version)])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'version_conflict' })
      // A save from a version that is no longer current never overwrites.
      await expect(site.update(t.tenantId, data, version)).rejects.toMatchObject({ code: 'version_conflict' })
      expect((await db.siteConfig.findUniqueOrThrow({ where: { tenantId: t.tenantId } })).version).toBe(version + 1)
    })
  })
})
