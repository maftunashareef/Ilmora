import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { AttendanceEvents } from '../src/modules/attendance/attendance.events'
import { AttendanceService } from '../src/modules/attendance/attendance.service'
import { RefundsService } from '../src/modules/enrollment/refunds.service'
import { SubscriptionService } from '../src/modules/enrollment/subscription.service'
import { ManageService } from '../src/modules/manage/manage.service'
import { PaymentsController } from '../src/modules/payments/payments.controller'
import { OUTBOX_MAX_ATTEMPTS } from '../src/modules/payments/outbox.service'
import { SessionsProcessor, STALE_RUN_MS } from '../src/modules/sessions/sessions.processor'
import { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { TenantsService } from '../src/modules/tenants/tenants.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'

describe('Reconciliation filter (security review 10.11 №43)', () => {
  it('a date that does not parse is refused by validation (400), not passed to the database', async () => {
    // The query class is not exported: take it from the route's parameter metadata.
    const types = Reflect.getMetadata('design:paramtypes', PaymentsController.prototype, 'reconcile') as (new () => object)[]
    const ReconQuery = types[1]
    const errors = async (q: object) => (await validate(plainToInstance(ReconQuery, q))).map((e) => e.property)
    expect(await errors({ from: 'yesterday' })).toEqual(['from'])
    expect(await errors({ to: '2026-02-30' })).toEqual(['to'])
    expect(await errors({ from: '2026-11-01', to: '2026-11-10T12:00:00Z' })).toEqual([])
  })
})

describe.skipIf(!DB_AVAILABLE)('Small fixes of the security review 10.11: payments and lessons (№38–№43, Н12–Н17)', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /** A student with a paid Duo subscription; optional package columns (e.g. a lesson package). */
  const paid = async (label: string, packageData?: object) => {
    const t = await ctx.makeTenant(label)
    const student = await ctx.makeStudent(t.tenantId)
    const pkg = packageData ? await TenantContext.forTenant(t.tenantId, () => db.package.create({ data: { tenantId: t.tenantId, code: `p-${label}`, name: { ru: 'Пакет' }, description: {}, perks: [], maxCourses: 2, ...packageData } })) : t.pkg
    const { payment, subscription } = await ctx.checkout(t.tenantId, student.id, pkg.id, [t.group.id, t.group2.id])
    await TenantContext.forTenant(t.tenantId, () => ctx.payments.manualSettle(payment.id, student.id, 'test'))
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    return { ...t, student, subscription, payment, inT }
  }

  it('№38: the nightly sweep does not block a subscription that changed after it was read (a renewal just paid)', async () => {
    const s = await paid('d2-race')
    await s.inT(async () => {
      const stale = await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })
      // Meanwhile a renewal settles and moves the period on.
      await db.subscription.update({ where: { id: stale.id }, data: { currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } })
      const block = (ctx.subscriptions as unknown as { block: (...a: unknown[]) => Promise<boolean> }).block.bind(ctx.subscriptions)
      expect(await block(db, stale, 'period_ended', new Date())).toBe(false)
      expect((await db.subscription.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('ACTIVE')
    })
  })

  it('№39: a payment made with the test key activates the order but books no revenue and sends no receipt', async () => {
    const t = await ctx.makeTenant('d2-sandbox')
    const student = await ctx.makeStudent(t.tenantId)
    const { payment } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    await TenantContext.forTenant(t.tenantId, async () => {
      await ctx.prisma.tx((tx) => ctx.payments.settle(tx, { paymentId: payment.id, provider: 'PAYME', providerTransactionId: `sb-${payment.id}`, performedAt: new Date(), sandbox: true }))
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).state).toBe('PAID')
      expect(await db.ledgerJournal.count({ where: { referenceId: payment.id } })).toBe(0)
    })
    expect(await TenantContext.system(() => db.outboxEvent.count({ where: { dedupeKey: `receipt:${payment.id}` } }))).toBe(0)
  })

  it('№40: a lesson cancelled and restored takes back the lessons of its check-ins (Н16 — see attendance.test)', async () => {
    const s = await paid('d2-lessons', { accessKind: 'LESSONS', lessonCount: 8 })
    const tenants = new TenantsService(ctx.prisma, ctx.env)
    const sessions = new SessionsService(ctx.prisma, tenants, ctx.env)
    const attendance = new AttendanceService(ctx.prisma, ctx.audit, { publish: async () => undefined } as unknown as AttendanceEvents, tenants, ctx.subscriptions, notificationsStub, ctx.env)
    const teacher = { id: s.teacherUser.id, roles: ['TEACHER' as const], teacherProfileId: s.teacher.id, centerId: null }
    await TenantContext.forTenant(s.tenantId, async () => {
      const group = await db.group.findFirstOrThrow({ where: { id: s.group.id } })
      await sessions.generateForGroup(group, sessions.todayLocal(), 14, 'test')
      const session = await db.lessonSession.findFirstOrThrow({ where: { groupId: s.group.id }, orderBy: { startsAt: 'asc' } })
      const { token } = await attendance.open(session.id, teacher)
      expect(await attendance.checkIn(s.student.id, { sessionId: session.id, token }, {})).toMatchObject({ ok: true })
      const used = async () => (await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })).lessonsUsed
      expect(await used()).toBe(1)
      await attendance.setStatus(session.id, 'cancelled', teacher)
      expect(await used()).toBe(0)
      await attendance.setStatus(session.id, 'scheduled', teacher)
      expect(await used()).toBe(1)
    }, { actor: teacher })
  })

  it('№42: «Cancel» on a paid subscription files a refund request and tells the finance admins', async () => {
    const s = await paid('d2-refund')
    const sent: { type: string; userIds: string[]; params?: object }[] = []
    const notify = { ...notificationsStub, notify: async (n: { type: string; userIds: string[] }) => { sent.push(n); return n.userIds.length } } as never
    const refunds = new RefundsService(ctx.prisma, ctx.audit, notify, ctx.ledger, new SubscriptionService(ctx.prisma, ctx.audit, notify, ctx.env))
    const finance = await s.inT(() => db.user.create({ data: { tenantId: s.tenantId, login: `fin-${s.tenantId.slice(0, 8)}`, displayName: 'Finance', roles: ['FINANCE_ADMIN'] } }))
    const out = await s.inT(() => refunds.cancelSubscription(s.tenantId, s.student.id, 'moving away'))
    expect(out).toMatchObject({ ok: true, refundRequested: true })
    expect(sent.find((n) => n.type === 'refund.requested')?.userIds).toEqual([finance.id])
    const request = await s.inT(() => db.refundRequest.findFirstOrThrow({ where: { subscriptionId: s.subscription.id } }))
    expect(request).toMatchObject({ status: 'PENDING', reason: 'REFUSAL', reasonText: 'moving away', paymentId: s.payment.id })
    expect((await s.inT(() => db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } }))).status).toBe('CANCELLED')
  })

  it('Н12: without a connected payment provider the checkout holds no seats', async () => {
    const t = await ctx.makeTenant('d2-noprovider')
    const student = await ctx.makeStudent(t.tenantId)
    const subs = new SubscriptionService(ctx.prisma, ctx.audit, notificationsStub, testEnv({ PAYME_MERCHANT_ID: '' }))
    await TenantContext.forTenant(t.tenantId, async () => {
      await subs.saveDraft(t.tenantId, student.id, { packageId: t.pkg.id, groupIds: [t.group.id, t.group2.id], meyosGrant: false })
      await expect(subs.checkout(t.tenantId, student.id, 'PAYME')).rejects.toMatchObject({ code: 'payment_unavailable' })
      expect(await db.enrollment.count({ where: { studentId: student.id } })).toBe(0)
      expect(await db.payment.count({ where: { studentId: student.id } })).toBe(0)
    })
  })

  it('Н13: a daily run left «RUNNING» by a stopped worker is taken over later; a live one is not', async () => {
    const processor = new SessionsProcessor({} as never, ctx.prisma, {} as never, {} as never, {} as never, {} as never, ctx.env)
    const runOnce = (processor as unknown as { runOnce: (q: string, k: string, fn: () => Promise<unknown>) => Promise<unknown> }).runOnce.bind(processor)
    const key = `daily-stale-${Date.now()}`
    await TenantContext.system(() => db.jobRun.create({ data: { queue: 'sessions', jobKey: key, startedAt: new Date(Date.now() - 60_000) } }))
    expect(await runOnce('sessions', key, async () => ({ ran: true }))).toEqual({ skipped: true })
    await TenantContext.system(() => db.jobRun.updateMany({ where: { queue: 'sessions', jobKey: key }, data: { startedAt: new Date(Date.now() - STALE_RUN_MS - 60_000) } }))
    expect(await runOnce('sessions', key, async () => ({ ran: true }))).toEqual({ ran: true })
    expect((await TenantContext.system(() => db.jobRun.findFirstOrThrow({ where: { queue: 'sessions', jobKey: key } }))).status).toBe('SUCCEEDED')
  })

  it('Н14: an event that failed too often is no longer claimed', async () => {
    const ev = await TenantContext.system(() => db.outboxEvent.create({ data: { tenantId: null, type: 'unknown.type', payload: {}, attempts: OUTBOX_MAX_ATTEMPTS, availableAt: new Date(Date.now() - 1000) } }))
    const claimed = await ctx.outbox.claim(500)
    expect(claimed.map((c) => c.id)).not.toContain(ev.id)
    await TenantContext.system(() => db.outboxEvent.delete({ where: { id: ev.id } }))
  })

  it('Н15: settling a paid payment by hand again records nothing', async () => {
    const s = await paid('d2-manual')
    const again = await s.inT(() => ctx.payments.manualSettle(s.payment.id, s.student.id, 'twice'))
    expect(again.applied).toBe(false)
    expect(await s.inT(() => db.paymentTransaction.count({ where: { paymentId: s.payment.id } }))).toBe(1)
  })

  it('Н17: online courses can be created again after the platform center «ILMORA Online» was deleted', async () => {
    const t = await ctx.makeTenant('d2-online')
    const manage = new ManageService(ctx.prisma, ctx.audit, {} as never, {} as SiteService, notificationsStub, ctx.env)
    const ensure = (manage as unknown as { ensureOnlineProvider: (id: string) => Promise<{ centerId: string; teacherId: string }> }).ensureOnlineProvider.bind(manage)
    await TenantContext.forTenant(t.tenantId, async () => {
      const first = await ensure(t.tenantId)
      await db.center.update({ where: { id: first.centerId }, data: { deletedAt: new Date() } })
      await db.teacherProfile.update({ where: { id: first.teacherId }, data: { deletedAt: new Date() } })
      expect(await ensure(t.tenantId)).toEqual(first)
      expect((await db.center.findFirstOrThrow({ where: { id: first.centerId } })).deletedAt).toBeNull()
    })
  })
})
