import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Request, Response } from 'express'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { CallbackLogBudget } from '../src/modules/payments/callback-log-budget'
import { PaymeController } from '../src/modules/payments/payme/payme.controller'
import { PAYME, PaymeError, type PaymeService } from '../src/modules/payments/payme/payme.service'
import { RENEW_WINDOW_DAYS } from '../src/modules/enrollment/subscription.service'
import { DB_AVAILABLE, TestContext } from './helpers'

const DAY = 86_400_000

describe('Callback log budget (security review №11)', () => {
  it('lets 20 unproven callbacks a minute per address into the log, then nothing until the minute is over', () => {
    const b = new CallbackLogBudget()
    const now = Date.now()
    expect(Array.from({ length: 25 }, () => b.allow('1.2.3.4', now)).filter(Boolean)).toHaveLength(20)
    expect(b.allow('5.6.7.8', now)).toBe(true)
    expect(b.allow('1.2.3.4', now + 61_000)).toBe(true)
  })
})

describe.skipIf(!DB_AVAILABLE)('Payme fixes of the security review 10.11 (Н2, №7–№12)', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /** A student with a paid Duo subscription (two courses, 50 000 + 30 000 so'm a month). */
  const paid = async (label: string, packageData?: object) => {
    const t = await ctx.makeTenant(label)
    const student = await ctx.makeStudent(t.tenantId)
    const pkg = packageData ? await TenantContext.forTenant(t.tenantId, () => db.package.create({ data: { tenantId: t.tenantId, code: `p-${label}`, name: {}, description: {}, perks: [], maxCourses: 2, ...packageData } })) : t.pkg
    const { payment, subscription } = await ctx.checkout(t.tenantId, student.id, pkg.id, [t.group.id, t.group2.id])
    await TenantContext.forTenant(t.tenantId, () => ctx.payments.manualSettle(payment.id, student.id, 'test'))
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    return { ...t, student, subscription, payment, inT }
  }

  it('Н2: after a payment that expired or failed, the same groups can be paid for again', async () => {
    const t = await ctx.makeTenant('pm-h2')
    const student = await ctx.makeStudent(t.tenantId)
    const first = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    await TenantContext.forTenant(t.tenantId, async () => {
      await db.payment.update({ where: { id: first.payment.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
      expect(await ctx.subscriptions.expirePending(t.tenantId)).toBe(1)
    })
    const again = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    expect(again.payment.state).toBe('PENDING')
    expect(await TenantContext.forTenant(t.tenantId, () => db.enrollment.count({ where: { subscriptionId: again.subscription.id, status: 'PENDING' } }))).toBe(2)
  })

  it('№12: seats are held an hour; a payment Payme is processing keeps its hold until Payme decides', async () => {
    const t = await ctx.makeTenant('pm-hold')
    const student = await ctx.makeStudent(t.tenantId)
    const { payment } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    expect(payment.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000)
    await TenantContext.forTenant(t.tenantId, async () => {
      await db.payment.update({ where: { id: payment.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
      await db.paymentTransaction.create({ data: { tenantId: t.tenantId, paymentId: payment.id, provider: 'PAYME', providerTransactionId: `ptx-${t.tenantId}`, state: 'CREATED', amountMinor: payment.amountMinor, currency: 'UZS' } })
      expect(await ctx.subscriptions.expirePending(t.tenantId)).toBe(0)
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).state).toBe('PENDING')
    })
  })

  it('№8, №9: a renewal only in the last 7 days, at today’s price, and only while every course is still open', async () => {
    const s = await paid('pm-renew')
    await s.inT(async () => {
      await expect(ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')).rejects.toMatchObject({ code: 'renewal_too_early' })
      await db.subscription.update({ where: { id: s.subscription.id }, data: { currentPeriodEnd: new Date(Date.now() + (RENEW_WINDOW_DAYS - 2) * DAY) } })
      // The center raised the price: the renewal costs today's price, not the first payment's.
      await db.course.update({ where: { id: s.course.id }, data: { priceMinor: 70_000_00n } })
      const { payment } = await ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')
      expect(payment.amountMinor).toBe(70_000_00n + 30_000_00n)
      // The course archived after the order: Payme is told the order cannot be paid; a new renewal is refused.
      await db.course.update({ where: { id: s.course2.id }, data: { status: 'ARCHIVED' } })
      expect(await ctx.payments.settleBlocker(db, payment)).toBe('subscription_closed')
      await db.payment.update({ where: { id: payment.id }, data: { state: 'CANCELLED' } })
      await expect(ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')).rejects.toMatchObject({ code: 'renewal_unavailable' })
      await db.course.update({ where: { id: s.course2.id }, data: { status: 'PUBLISHED' } })
      await db.center.update({ where: { id: s.center.id }, data: { status: 'BLOCKED' } })
      await expect(ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')).rejects.toMatchObject({ code: 'renewal_unavailable' })
    })
  })

  it('№7: renewing a lesson package adds to the lessons left — 8, 6 attended, renewed: 10', async () => {
    const s = await paid('pm-lessons', { accessKind: 'LESSONS', lessonCount: 8 })
    await s.inT(async () => {
      expect(await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })).toMatchObject({ kind: 'LESSONS', lessonsTotal: 8 })
      await db.subscription.update({ where: { id: s.subscription.id }, data: { lessonsUsed: 6 } })
      const { payment } = await ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')
      await ctx.payments.manualSettle(payment.id, s.student.id, 'test')
      expect(await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })).toMatchObject({ lessonsTotal: 10, lessonsUsed: 0 })
    })
  })

  it('№10: a refund of the month paid ahead shortens the subscription; of the current one — the month ahead starts now', async () => {
    const s = await paid('pm-refund')
    await s.inT(async () => {
      const firstEnd = new Date(Date.now() + 3 * DAY)
      await db.subscription.update({ where: { id: s.subscription.id }, data: { currentPeriodEnd: firstEnd } })
      await db.payment.update({ where: { id: s.payment.id }, data: { periodEnd: firstEnd } })
      const { payment: ahead } = await ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')
      await ctx.payments.manualSettle(ahead.id, s.student.id, 'test')
      expect((await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })).currentPeriodEnd!.getTime()).toBe(ahead.periodEnd.getTime())

      // The month ahead refunded: the subscription goes on to the end of the current month, not cancelled.
      await ctx.prisma.tx((tx) => ctx.payments.refundPaid(tx, ahead.id, 'test'))
      expect(await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })).toMatchObject({ status: 'ACTIVE', currentPeriodEnd: firstEnd })

      // Paid ahead again, then the current month refunded: its access goes, the month ahead starts now.
      const { payment: again } = await ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')
      await ctx.payments.manualSettle(again.id, s.student.id, 'test')
      const length = again.periodEnd.getTime() - again.periodStart.getTime()
      await ctx.prisma.tx((tx) => ctx.payments.refundPaid(tx, s.payment.id, 'test'))
      const sub = await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })
      expect(sub.status).toBe('ACTIVE')
      expect(Math.abs(sub.currentPeriodStart!.getTime() - Date.now())).toBeLessThan(60_000)
      expect(Math.abs(sub.currentPeriodEnd!.getTime() - (Date.now() + length))).toBeLessThan(60_000)

      // The only paid month refunded while it runs: the subscription ends.
      await ctx.prisma.tx((tx) => ctx.payments.refundPaid(tx, again.id, 'test'))
      expect((await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })).status).toBe('CANCELLED')
    })
  })

  it('№11: a callback without Payme’s password is logged without its body, within the budget; old logs are purged', async () => {
    const payme = { authenticate: () => { throw new PaymeError(PAYME.UNAUTHORIZED, { ru: 'x', uz: 'x', en: 'x' }) } } as unknown as PaymeService
    const controller = new PaymeController(payme, ctx.prisma, ctx.env)
    const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.9`
    const res = { status: () => res, type: () => res, send: () => res } as unknown as Response
    const junk = { method: 'CheckPerformTransaction', params: { garbage: 'x'.repeat(50_000) }, id: 1 }
    for (let i = 0; i < 25; i++) await controller.rpc({ method: 'POST', ip, body: junk } as unknown as Request, res, 'Basic bad')
    const rows = await TenantContext.system(() => db.providerCallbackLog.findMany({ where: { ip }, select: { payload: true, tenantId: true, method: true } }))
    expect(rows).toHaveLength(20)
    expect(rows[0]).toEqual({ payload: {}, tenantId: null, method: 'CheckPerformTransaction' })

    await TenantContext.system(() => db.providerCallbackLog.updateMany({ where: { ip }, data: { receivedAt: new Date(Date.now() - 8 * DAY) } }))
    expect(await ctx.payments.purgeCallbackLogs()).toBeGreaterThanOrEqual(20)
    expect(await TenantContext.system(() => db.providerCallbackLog.count({ where: { ip } }))).toBe(0)
  })
})
