import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { RENEW_WINDOW_DAYS } from '../src/modules/enrollment/subscription.service'
import { DB_AVAILABLE, TestContext } from './helpers'

const DAY = 86_400_000

/**
 * The data of refund requests (security review 10.11 №42, offer 6.3–6.6): what each payment paid per course
 * (PaymentLine), and the checks the database keeps whatever the code does (migration 20261117000000).
 */
describe.skipIf(!DB_AVAILABLE)('Refund requests: payment lines and the database checks', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /** A student with a paid Duo subscription: 50 000 so'm with a 10 % discount + 30 000 so'm a month. */
  const paid = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    await inT(() => db.course.update({ where: { id: t.course.id }, data: { discountPercent: 10, discountStartsAt: new Date(Date.now() - DAY), discountEndsAt: new Date(Date.now() + DAY) } }))
    const student = await ctx.makeStudent(t.tenantId)
    const { payment, subscription } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    await inT(() => ctx.payments.manualSettle(payment.id, student.id, 'test'))
    return { ...t, student, subscription, payment, inT }
  }

  it('keeps what each payment paid for each course, at checkout and at renewal, adding up to the amount', async () => {
    const s = await paid('rf-lines')
    await s.inT(async () => {
      const lines = await db.paymentLine.findMany({ where: { paymentId: s.payment.id }, include: { enrollment: true } })
      expect(lines.map((l) => [l.courseId, l.listPriceMinor, l.amountMinor]).sort()).toEqual([[s.course.id, 50_000_00n, 47_500_00n], [s.course2.id, 30_000_00n, 30_000_00n]].sort()) // the center entered 10%: the student's half is 5%
      expect(lines.every((l) => l.enrollment?.subscriptionId === s.subscription.id && l.enrollment.courseId === l.courseId)).toBe(true)
      expect(lines.reduce((sum, l) => sum + l.amountMinor, 0n)).toBe(s.payment.amountMinor)

      // The discount ended and the price went up: the renewal pays today's price, the first payment's lines stay.
      await db.course.update({ where: { id: s.course.id }, data: { priceMinor: 70_000_00n, discountPercent: null, discountStartsAt: null, discountEndsAt: null } })
      await db.subscription.update({ where: { id: s.subscription.id }, data: { currentPeriodEnd: new Date(Date.now() + (RENEW_WINDOW_DAYS - 2) * DAY) } })
      const { payment: next } = await ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')
      const nextLines = await db.paymentLine.findMany({ where: { paymentId: next.id } })
      expect(nextLines.map((l) => l.amountMinor).sort()).toEqual([30_000_00n, 70_000_00n])
      expect(nextLines.reduce((sum, l) => sum + l.amountMinor, 0n)).toBe(next.amountMinor)
      expect((await db.paymentLine.findMany({ where: { paymentId: s.payment.id } })).map((l) => l.amountMinor).sort()).toEqual([30_000_00n, 47_500_00n])
    })
  })

  it('a new checkout after an expired one still works: the old holds go, their lines stay without them', async () => {
    const t = await ctx.makeTenant('rf-retry')
    const student = await ctx.makeStudent(t.tenantId)
    const first = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    await TenantContext.forTenant(t.tenantId, async () => {
      await db.payment.update({ where: { id: first.payment.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
      expect(await ctx.subscriptions.expirePending(t.tenantId)).toBe(1)
    })
    const again = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    await TenantContext.forTenant(t.tenantId, async () => {
      expect((await db.paymentLine.findMany({ where: { paymentId: again.payment.id } })).every((l) => l.enrollmentId)).toBe(true)
      const old = await db.paymentLine.findMany({ where: { paymentId: first.payment.id } })
      expect(old).toHaveLength(2)
      expect(old.every((l) => l.enrollmentId === null)).toBe(true)
    })
  })

  it('never lets more be returned than was paid, and keeps one open request per payment', async () => {
    const s = await paid('rf-checks')
    await s.inT(async () => {
      const amount = s.payment.amountMinor
      await expect(db.payment.update({ where: { id: s.payment.id }, data: { refundedMinor: amount + 1n } })).rejects.toThrow(/Payment_refundedMinor_check/)
      await expect(db.payment.update({ where: { id: s.payment.id }, data: { refundedMinor: -1n } })).rejects.toThrow(/Payment_refundedMinor_check/)
      // REFUNDED means all of it is returned.
      await expect(db.payment.update({ where: { id: s.payment.id }, data: { state: 'REFUNDED', refundedMinor: amount - 1n } })).rejects.toThrow(/Payment_refundedMinor_check/)
      await db.payment.update({ where: { id: s.payment.id }, data: { refundedMinor: amount - 1n } })

      const enrollment = await db.enrollment.findFirstOrThrow({ where: { subscriptionId: s.subscription.id, courseId: s.course.id } })
      const request = (over: Record<string, unknown> = {}) => ({
        tenantId: s.tenantId, studentId: s.student.id, subscriptionId: s.subscription.id, paymentId: s.payment.id, reason: 'REFUSAL' as const,
        source: 'CABINET' as const, requestedMinor: 10_000_00n, decisionDueAt: new Date(Date.now() + 10 * DAY), openKey: s.payment.id, createdById: s.student.id, ...over,
      })
      const open = await db.refundRequest.create({
        data: { ...request(), lines: { create: [{ tenantId: s.tenantId, enrollmentId: enrollment.id, courseId: s.course.id, priceMinor: 45_000_00n, lessonsTotal: 8, lessonsHeld: 6, amountMinor: 11_250_00n }] } },
      })
      // A second open request for the same payment is refused; an open one must hold its payment's key, a closed one none.
      await expect(db.refundRequest.create({ data: request() })).rejects.toThrow(/openKey/)
      await expect(db.refundRequest.create({ data: request({ openKey: null }) })).rejects.toThrow(/RefundRequest_openKey_check/)
      await expect(db.refundRequest.update({ where: { id: open.id }, data: { status: 'REJECTED' } })).rejects.toThrow(/RefundRequest_openKey_check/)
      await db.refundRequest.update({ where: { id: open.id }, data: { status: 'REJECTED', openKey: null } })
      await db.refundRequest.create({ data: request() })

      // The numbers of a line: no more lessons held than in the period, no more returned than paid for the course.
      const line = (over: Record<string, unknown>) => ({ tenantId: s.tenantId, refundRequestId: open.id, enrollmentId: enrollment.id, courseId: s.course.id, priceMinor: 45_000_00n, lessonsTotal: 8, lessonsHeld: 6, amountMinor: 11_250_00n, ...over })
      await db.refundRequestLine.deleteMany({ where: { refundRequestId: open.id } })
      await expect(db.refundRequestLine.create({ data: line({ lessonsHeld: 9 }) })).rejects.toThrow(/RefundRequestLine_count_check/)
      await expect(db.refundRequestLine.create({ data: line({ amountMinor: 45_000_01n }) })).rejects.toThrow(/RefundRequestLine_count_check/)
      await expect(db.refundRequest.update({ where: { id: open.id }, data: { approvedMinor: -1n } })).rejects.toThrow(/RefundRequest_amounts_check/)
    })
  })

  it('lets a cancellation with the next period paid ahead make one request per payment', async () => {
    const s = await paid('rf-two')
    await s.inT(async () => {
      await db.subscription.update({ where: { id: s.subscription.id }, data: { currentPeriodEnd: new Date(Date.now() + (RENEW_WINDOW_DAYS - 2) * DAY) } })
      const { payment: next } = await ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')
      await ctx.payments.manualSettle(next.id, s.student.id, 'test')
      for (const p of [s.payment, next]) {
        await db.refundRequest.create({
          data: { tenantId: s.tenantId, studentId: s.student.id, subscriptionId: s.subscription.id, paymentId: p.id, reason: 'REFUSAL', source: 'CABINET', requestedMinor: 0n, decisionDueAt: new Date(Date.now() + 10 * DAY), openKey: p.id, createdById: s.student.id },
        })
      }
      expect(await db.refundRequest.count({ where: { subscriptionId: s.subscription.id, status: 'PENDING' } })).toBe(2)
    })
  })

  it('keeps refund requests and payment lines inside their organization', async () => {
    const s = await paid('rf-tenant')
    const other = await ctx.makeTenant('rf-tenant-b')
    await s.inT(() =>
      db.refundRequest.create({
        data: { tenantId: s.tenantId, studentId: s.student.id, subscriptionId: s.subscription.id, paymentId: s.payment.id, reason: 'OTHER', reasonText: 'x', source: 'EMAIL', requestedMinor: 0n, decisionDueAt: new Date(), openKey: s.payment.id, createdById: s.student.id },
      }),
    )
    await TenantContext.forTenant(other.tenantId, async () => {
      expect(await db.refundRequest.count({ where: { paymentId: s.payment.id } })).toBe(0)
      expect(await db.paymentLine.count({ where: { paymentId: s.payment.id } })).toBe(0)
    })
  })
})
