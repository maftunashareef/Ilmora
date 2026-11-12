import 'reflect-metadata'
import { Reflector } from '@nestjs/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROLES_KEY } from '../src/common/decorators'
import { RefundsAdminController } from '../src/modules/enrollment/refunds-admin.controller'
import { addDays } from '../src/common/time'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { countLessons, refundShare, splitByPrice } from '../src/modules/enrollment/refund-count'
import { formatSom, RefundsService } from '../src/modules/enrollment/refunds.service'
import type { NotificationsService } from '../src/modules/notifications/notifications.service'
import { ReconciliationService } from '../src/modules/payments/reconciliation.service'
import { SessionsService } from '../src/modules/sessions/sessions.service'
import { TenantsService } from '../src/modules/tenants/tenants.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

const DAY = 86_400_000

describe('Refund count of the offer, 6.4 (security review 10.11 №42)', () => {
  const weekly = { days: [0, 2], startTime: '18:00', timezone: 'Asia/Tashkent' } // Monday and Wednesday, 18:00 Tashkent
  const at = (iso: string) => new Date(iso)

  it('counts the calendar, a lesson moved once, a cancelled one as not held, and the weekly schedule beyond the calendar', () => {
    // Period 2 – 30 November 2026 (Mondays and Wednesdays: 2, 4, 9, 11, 16, 18, 23, 25 — 8 lessons); refusal on 12 November.
    const s = (id: string, date: string, status = 'COMPLETED', from: string | null = null) => ({ id, startsAt: at(`${date}T13:00:00Z`), status, rescheduledFromId: from })
    const c = countLessons({
      periodStart: at('2026-11-01T19:00:00Z'), periodEnd: at('2026-11-29T19:00:00Z'), at: at('2026-11-12T06:00:00Z'),
      sessions: [s('a', '2026-11-02'), s('b', '2026-11-04', 'CANCELLED'), s('b2', '2026-11-06', 'COMPLETED', 'b'), s('c', '2026-11-09', 'CANCELLED'), s('d', '2026-11-11'), s('e', '2026-11-16', 'SCHEDULED')],
      lastCalendarDate: '2026-11-16', weekly,
    })
    // 2, 6 (moved from 4), 9 (cancelled), 11, 16 from the calendar + 18, 23, 25 by the schedule.
    expect(c).toEqual({ total: 8, held: 3, notHeld: 1 })
    expect(refundShare(80_000_00n, c.total, c.held)).toBe(50_000_00n) // 5 of 8 lessons not held
  })

  it('a lesson moved past the period end is held, not refunded; a one-off lesson far ahead does not end the weekly schedule (review 11.11)', () => {
    const s = (id: string, iso: string, status = 'COMPLETED', from: string | null = null) => ({ id, startsAt: at(iso), status, rescheduledFromId: from })
    const moved = countLessons({
      periodStart: at('2026-11-01T19:00:00Z'), periodEnd: at('2026-11-08T19:00:00Z'), at: at('2026-11-20T00:00:00Z'),
      sessions: [s('a', '2026-11-02T13:00:00Z'), s('b', '2026-11-04T13:00:00Z', 'CANCELLED'), s('b2', '2026-12-03T13:00:00Z', 'SCHEDULED', 'b')],
      lastCalendarDate: '2026-11-30', weekly,
    })
    expect(moved).toEqual({ total: 1, held: 1, notHeld: 0 })
    // The calendar ends on 16 November; a one-off on 20 December does not hide the weekly lessons in between.
    const ahead = countLessons({ periodStart: at('2026-11-15T19:00:00Z'), periodEnd: at('2026-12-15T19:00:00Z'), at: at('2026-11-10T00:00:00Z'), sessions: [s('x', '2026-11-16T13:00:00Z', 'SCHEDULED')], lastCalendarDate: '2026-11-16', weekly })
    expect(ahead.total).toBe(9) // 16, 18, 23, 25, 30 Nov and 2, 7, 9, 14 Dec
  })

  it('returns a period paid ahead whole, and everything when the period has no lesson', () => {
    const c = countLessons({ periodStart: at('2026-12-01T00:00:00Z'), periodEnd: at('2027-01-01T00:00:00Z'), at: at('2026-11-20T00:00:00Z'), sessions: [], lastCalendarDate: null, weekly })
    expect(c.held).toBe(0)
    expect(refundShare(30_000_00n, c.total, c.held)).toBe(30_000_00n)
    expect(refundShare(30_000_00n, 0, 0)).toBe(30_000_00n)
  })

  it('writes so\'m for the notification text: spaces between thousands, tiyin after a comma', () => {
    expect(formatSom(72_000_00n)).toBe('72 000')
    expect(formatSom(4_531_250n)).toBe('45 312,50')
    expect(formatSom(5n)).toBe('0,05')
  })

  it('splits an old payment by the courses\' prices, the parts adding up to it', () => {
    expect(splitByPrice(72_000_00n, [50_000_00n, 30_000_00n])).toEqual([45_000_00n, 27_000_00n])
    const odd = splitByPrice(100n, [1n, 1n, 1n])
    expect(odd.reduce((a, b) => a + b, 0n)).toBe(100n)
  })
})

describe.skipIf(!DB_AVAILABLE)('Refund requests: the student, the finance admin, the money (security review 10.11 №42)', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const sent: { type: string; userIds: string[]; params?: Record<string, unknown> }[] = []
  const notifications = { ...notificationsStub, notify: async (n: { type: string; userIds: string[] }) => { sent.push(n); return n.userIds.length } } as unknown as NotificationsService
  const refunds = new RefundsService(ctx.prisma, ctx.audit, notifications, ctx.ledger, ctx.subscriptions)
  const tenants = new TenantsService(ctx.prisma, ctx.env)
  const sessions = new SessionsService(ctx.prisma, tenants, ctx.env)

  /**
   * A student with a paid Duo subscription (50 000 + 30 000 so'm) whose month started 10 days ago, the lessons of both
   * groups in the calendar, and a finance admin.
   */
  const paid = async (label: string, packageData?: object) => {
    const t = await ctx.makeTenant(label)
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const student = await ctx.makeStudent(t.tenantId)
    const pkg = packageData ? await inT(() => db.package.create({ data: { tenantId: t.tenantId, code: `p-${label}`, name: {}, description: {}, perks: [], maxCourses: 2, ...packageData } })) : t.pkg
    const { payment, subscription } = await ctx.checkout(t.tenantId, student.id, pkg.id, [t.group.id, t.group2.id])
    await inT(() => ctx.payments.manualSettle(payment.id, student.id, 'test'))
    const start = new Date(Date.now() - 10 * DAY)
    const end = new Date(start.getTime() + 30 * DAY)
    await inT(async () => {
      await db.payment.update({ where: { id: payment.id }, data: { periodStart: start, periodEnd: end } })
      await db.subscription.update({ where: { id: subscription.id }, data: { currentPeriodStart: start, currentPeriodEnd: end } })
      for (const g of await db.group.findMany({ where: { id: { in: [t.group.id, t.group2.id] } } })) await sessions.generateForGroup(g, addDays(sessions.todayLocal(start), -1), 45, 'test')
    })
    const finance = await inT(() => db.user.create({ data: { tenantId: t.tenantId, login: `fin-${t.tenantId.slice(-8)}`, displayName: 'Finance', roles: ['FINANCE_ADMIN'] } }))
    const enrollments = await inT(() => db.enrollment.findMany({ where: { subscriptionId: subscription.id }, orderBy: { courseId: 'asc' } }))
    const byCourse = (courseId: string) => enrollments.find((e) => e.courseId === courseId)!
    return { ...t, inT, student, payment, subscription, finance, byCourse }
  }
  const file = (s: Awaited<ReturnType<typeof paid>>, input: Parameters<RefundsService['refuse']>[2]) =>
    s.inT(() => refunds.refuse(s.tenantId, s.student.id, input, { source: 'CABINET', actorId: s.student.id }))

  it('a refusal mid-month: one request counted by 6.4 per course, the seats freed, the subscription ended, the finance admins told', async () => {
    const s = await paid('rf-whole')
    sent.length = 0
    const quote = await s.inT(() => refunds.quote(s.tenantId, s.student.id, { reason: 'REFUSAL' }))
    const out = await file(s, { reason: 'REFUSAL', reasonText: 'moving away' })
    expect(out.requests).toHaveLength(1)
    expect(out.requests[0].requestedMinor).toBe(quote.requests[0].requestedMinor)
    await s.inT(async () => {
      const r = await db.refundRequest.findUniqueOrThrow({ where: { id: out.requests[0].id }, include: { lines: true } })
      expect(r).toMatchObject({ status: 'PENDING', paymentId: s.payment.id, openKey: s.payment.id, source: 'CABINET', reason: 'REFUSAL' })
      expect(r.decisionDueAt.getTime() - r.createdAt.getTime()).toBeGreaterThan(9.9 * DAY)
      expect(r.lines).toHaveLength(2)
      for (const l of r.lines) {
        expect(l.lessonsHeld).toBeGreaterThan(0)
        expect(l.lessonsHeld).toBeLessThan(l.lessonsTotal)
        expect(l.amountMinor).toBe(refundShare(l.priceMinor, l.lessonsTotal, l.lessonsHeld))
      }
      expect(r.requestedMinor).toBe(r.lines.reduce((a, l) => a + l.amountMinor, 0n))
      expect(await db.enrollment.count({ where: { subscriptionId: s.subscription.id, status: 'ACTIVE' } })).toBe(0)
      expect((await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })).status).toBe('CANCELLED')
    })
    expect(sent.find((n) => n.type === 'refund.requested')?.userIds).toEqual([s.finance.id])
    // One open request per payment.
    expect(await s.inT(() => db.auditEvent.count({ where: { action: 'refund.requested', entityId: out.requests[0].id } }))).toBe(1)
  })

  it('with the next month paid ahead: two requests — the current month by the count, the next one whole', async () => {
    const s = await paid('rf-ahead')
    await s.inT(async () => {
      await db.subscription.update({ where: { id: s.subscription.id }, data: { currentPeriodEnd: new Date(Date.now() + 5 * DAY) } })
      await db.payment.update({ where: { id: s.payment.id }, data: { periodEnd: new Date(Date.now() + 5 * DAY) } })
      const { payment: ahead } = await ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')
      await ctx.payments.manualSettle(ahead.id, s.student.id, 'test')
      sent.length = 0
      const out = await refunds.refuse(s.tenantId, s.student.id, { reason: 'REFUSAL' }, { source: 'CABINET', actorId: s.student.id })
      expect(out.requests).toHaveLength(2)
      // One notification per request, each with its own amount by 6.4 and a link to it in the queue — none with the payments' total.
      const told = sent.filter((n) => n.type === 'refund.requested')
      expect(told.map((n) => [n.params?.requestId, n.params?.amountMinor]).sort()).toEqual(out.requests.map((r) => [r.id, r.requestedMinor]).sort())
      for (const n of told) expect(n.params).toMatchObject({ queuePath: `/admin/finance?tab=refunds&request=${n.params?.requestId}`, days: 10 })
      expect(told.find((n) => n.params?.paymentId === ahead.id)?.params?.amount).toBe(formatSom(ahead.amountMinor))
      const next = out.requests.find((r) => r.paymentId === ahead.id)!
      expect(next.requestedMinor).toBe(ahead.amountMinor.toString())
      expect(BigInt(out.requests.find((r) => r.paymentId === s.payment.id)!.requestedMinor)).toBeLessThan(s.payment.amountMinor)
    })
  })

  it('one course of two: only its part is asked for, the other course goes on; a center\'s fault returns its part whole', async () => {
    const s = await paid('rf-one')
    const e2 = s.byCourse(s.course2.id)
    const out = await file(s, { enrollmentIds: [e2.id], reason: 'GROUP_CLOSED' })
    expect(out.requests[0].requestedMinor).toBe((30_000_00n).toString())
    await s.inT(async () => {
      const line = await db.refundRequestLine.findFirstOrThrow({ where: { refundRequestId: out.requests[0].id } })
      expect(line).toMatchObject({ enrollmentId: e2.id, lessonsHeld: 0, amountMinor: 30_000_00n })
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: e2.id } })).status).toBe('CANCELLED')
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: s.byCourse(s.course.id).id } })).status).toBe('ACTIVE')
      expect((await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })).status).toBe('ACTIVE')
    })
    // A second request for the same payment while the first waits.
    await expect(file(s, { enrollmentIds: [s.byCourse(s.course.id).id], reason: 'REFUSAL' })).rejects.toMatchObject({ code: 'refund_open' })
    await expect(file(s, { reason: 'OTHER' })).rejects.toMatchObject({ code: 'refund_reason_text' })
  })

  it('the finance admin approves within what is left, marks it paid: a journal under the request, the payment partly refunded, reconciliation clean', async () => {
    const s = await paid('rf-pay')
    const out = await file(s, { enrollmentIds: [s.byCourse(s.course2.id).id], reason: 'REFUSAL' })
    const id = out.requests[0].id
    await s.inT(async () => {
      await expect(refunds.markPaid(s.tenantId, s.finance.id, id, 'bank-1')).rejects.toMatchObject({ code: 'refund_state' })
      await expect(refunds.approve(s.tenantId, s.finance.id, id, s.payment.amountMinor + 1n)).rejects.toMatchObject({ code: 'refund_amount' })
      await refunds.approve(s.tenantId, s.finance.id, id, 10_000_00n, 'by the count')
      expect(await refunds.markPaid(s.tenantId, s.finance.id, id, 'bank-transfer-77')).toMatchObject({ paymentRefundedMinor: (10_000_00n).toString(), paymentState: 'PAID' })
      const r = await db.refundRequest.findUniqueOrThrow({ where: { id } })
      expect(r).toMatchObject({ status: 'PAID', openKey: null, providerRef: 'bank-transfer-77', approvedMinor: 10_000_00n })
      const j = await db.ledgerJournal.findFirstOrThrow({ where: { referenceType: 'RefundRequest', referenceId: id }, include: { entries: true } })
      expect(j.kind).toBe('PAYMENT_REFUNDED')
      expect(j.entries.map((e) => [e.account, e.direction, e.amountMinor])).toEqual(expect.arrayContaining([['revenue:subscriptions', 'DEBIT', 10_000_00n], ['clearing:manual', 'CREDIT', 10_000_00n]]))
      const recon = await new ReconciliationService(ctx.prisma).list(s.tenantId, {})
      const row = recon.items.find((i) => i.paymentId === s.payment.id)!
      expect(row).toMatchObject({ paymentRefundedMinor: (10_000_00n).toString(), discrepancy: null })
      // A whole cancellation by the provider would now return the 10 000 a second time: refused.
      expect(await ctx.prisma.tx((tx) => ctx.payments.refundPaid(tx, s.payment.id, 'payme-cancel:5'))).toBe(false)
    })
  })

  it('everything returned through requests makes the payment REFUNDED; reconciliation sees the refund', async () => {
    const s = await paid('rf-full')
    const out = await file(s, { reason: 'NOT_AS_DESCRIBED', reasonText: 'not the course described' })
    const id = out.requests[0].id
    await s.inT(async () => {
      expect(out.requests[0].requestedMinor).toBe(s.payment.amountMinor.toString())
      await refunds.approve(s.tenantId, s.finance.id, id, s.payment.amountMinor)
      await refunds.markPaid(s.tenantId, s.finance.id, id, 'bank-2')
      expect(await db.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).toMatchObject({ state: 'REFUNDED', refundedMinor: s.payment.amountMinor })
      const row = (await new ReconciliationService(ctx.prisma).list(s.tenantId, {})).items.find((i) => i.paymentId === s.payment.id)!
      expect(row.discrepancy).toBeNull()
      expect(row.ledger.refunded).toBe(true)
      // №77: returned in full by transfer — a later cancellation of the same payment in Payme's cabinet is refused, not
      // answered «cancelled» (Payme would pay the card a second time).
      expect(await ctx.prisma.tx((tx) => ctx.payments.refundPaid(tx, s.payment.id, 'payme-cancel:5'))).toBe(false)
      expect(await db.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).toMatchObject({ state: 'REFUNDED', refundedMinor: s.payment.amountMinor })
    })
  })

  it('a whole refund through Payme closes the request waiting for it; reject and withdraw close requests too', async () => {
    const s = await paid('rf-close')
    const out = await file(s, { reason: 'REFUSAL' })
    await s.inT(async () => {
      expect(await ctx.prisma.tx((tx) => ctx.payments.refundPaid(tx, s.payment.id, 'payme-cancel:5'))).toBe(true)
      expect(await db.refundRequest.findUniqueOrThrow({ where: { id: out.requests[0].id } })).toMatchObject({ status: 'PAID', openKey: null, approvedMinor: s.payment.amountMinor, providerRef: 'payme-cancel:5' })
    })
    const s2 = await paid('rf-reject')
    const r2 = await file(s2, { enrollmentIds: [s2.byCourse(s2.course.id).id], reason: 'REFUSAL' })
    await s2.inT(async () => {
      await refunds.reject(s2.tenantId, s2.finance.id, r2.requests[0].id, 'all lessons were held')
      expect(await db.refundRequest.findUniqueOrThrow({ where: { id: r2.requests[0].id } })).toMatchObject({ status: 'REJECTED', openKey: null, decisionNote: 'all lessons were held' })
      // Closed: a new request for the same payment can be filed.
      const r3 = await refunds.refuse(s2.tenantId, s2.student.id, { enrollmentIds: [s2.byCourse(s2.course2.id).id], reason: 'REFUSAL' }, { source: 'EMAIL', actorId: s2.finance.id })
      await expect(refunds.withdraw(s2.tenantId, 'someone-else', r3.requests[0].id)).rejects.toMatchObject({ code: 'refund_state' })
      await refunds.withdraw(s2.tenantId, s2.student.id, r3.requests[0].id)
      expect(await db.refundRequest.findUniqueOrThrow({ where: { id: r3.requests[0].id } })).toMatchObject({ status: 'WITHDRAWN', openKey: null, source: 'EMAIL' })
    })
  })

  it('a lesson package is refused whole, by the share of lessons not used', async () => {
    const s = await paid('rf-lessons', { accessKind: 'LESSONS', lessonCount: 8 })
    await s.inT(() => db.subscription.update({ where: { id: s.subscription.id }, data: { lessonsUsed: 2 } }))
    await expect(file(s, { enrollmentIds: [s.byCourse(s.course.id).id], reason: 'REFUSAL' })).rejects.toMatchObject({ code: 'refund_whole_package' })
    const out = await file(s, { reason: 'REFUSAL' })
    await s.inT(async () => {
      const lines = await db.refundRequestLine.findMany({ where: { refundRequestId: out.requests[0].id } })
      for (const l of lines) expect(l).toMatchObject({ lessonsTotal: 8, lessonsHeld: 2, amountMinor: (l.priceMinor * 6n) / 8n })
    })
  })

  it('a payment made before the per-course lines is split by the courses\' prices', async () => {
    const s = await paid('rf-old')
    await s.inT(() => db.paymentLine.deleteMany({ where: { paymentId: s.payment.id } }))
    const out = await file(s, { reason: 'GROUP_CLOSED' })
    await s.inT(async () => {
      const lines = await db.refundRequestLine.findMany({ where: { refundRequestId: out.requests[0].id } })
      expect(lines.map((l) => l.priceMinor).sort()).toEqual([30_000_00n, 50_000_00n])
      expect(out.requests[0].requestedMinor).toBe(s.payment.amountMinor.toString())
    })
  })

  it('an old payment without lines is split over the courses it paid for, even after one was refused (review 11.11)', async () => {
    const s = await paid('rf-old2')
    await s.inT(() => db.paymentLine.deleteMany({ where: { paymentId: s.payment.id } }))
    const first = await file(s, { enrollmentIds: [s.byCourse(s.course2.id).id], reason: 'GROUP_CLOSED' })
    expect(first.requests[0].requestedMinor).toBe((30_000_00n).toString())
    await s.inT(async () => {
      await refunds.approve(s.tenantId, s.finance.id, first.requests[0].id, 30_000_00n)
      await refunds.markPaid(s.tenantId, s.finance.id, first.requests[0].id, 'bank-3')
    })
    // The second course keeps its own part (50 000), not the whole payment.
    const second = await file(s, { reason: 'REFUSAL' })
    const line = await s.inT(() => db.refundRequestLine.findFirstOrThrow({ where: { refundRequestId: second.requests[0].id } }))
    expect(line.priceMinor).toBe(50_000_00n)
    expect(line.amountMinor).toBe(refundShare(50_000_00n, line.lessonsTotal, line.lessonsHeld))
  })

  it('an earlier refund comes off by what was actually paid; a payment by the test key is not refunded', async () => {
    const s = await paid('rf-paid-amount')
    const e2 = s.byCourse(s.course2.id)
    const r1 = await file(s, { enrollmentIds: [e2.id], reason: 'LESSONS_NOT_HELD' })
    expect(r1.requests).toHaveLength(0) // no lesson was cancelled: nothing to return, the course goes on
    const r2 = await file(s, { enrollmentIds: [e2.id], reason: 'PLATFORM_FAULT', reasonText: 'no access for a week' })
    await s.inT(async () => {
      await refunds.approve(s.tenantId, s.finance.id, r2.requests[0].id, 5_000_00n)
      await refunds.markPaid(s.tenantId, s.finance.id, r2.requests[0].id, 'bank-4')
    })
    const r3 = await file(s, { enrollmentIds: [e2.id], reason: 'GROUP_CLOSED' })
    expect(r3.requests[0].requestedMinor).toBe((25_000_00n).toString()) // 30 000 less the 5 000 already returned
    const t = await paid('rf-sandbox')
    await t.inT(() => db.paymentTransaction.updateMany({ where: { paymentId: t.payment.id }, data: { sandbox: true } }))
    expect((await file(t, { reason: 'GROUP_CLOSED' })).requests).toHaveLength(0)
  })

  it('a lesson package refunds the lessons carried from the earlier payment too', async () => {
    const s = await paid('rf-carry', { accessKind: 'LESSONS', lessonCount: 8 })
    await s.inT(async () => {
      await db.subscription.update({ where: { id: s.subscription.id }, data: { lessonsUsed: 4 } })
      const { payment: renewal } = await ctx.subscriptions.renew(s.tenantId, s.student.id, 'PAYME')
      await ctx.payments.manualSettle(renewal.id, s.student.id, 'test')
      expect(await db.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } })).toMatchObject({ lessonsTotal: 12, lessonsUsed: 0 })
      const out = await refunds.refuse(s.tenantId, s.student.id, { reason: 'REFUSAL' }, { source: 'CABINET', actorId: s.student.id })
      // 12 unused: 8 from the renewal (all of it) and 4 from the first payment (half of it).
      expect(out.requests.find((r) => r.paymentId === renewal.id)?.requestedMinor).toBe(renewal.amountMinor.toString())
      expect(out.requests.find((r) => r.paymentId === s.payment.id)?.requestedMinor).toBe((s.payment.amountMinor / 2n).toString())
    })
  })

  it('a withdrawal and an approval at once: one wins, the other gets refund_state, never a 500', async () => {
    const s = await paid('rf-race')
    const out = await file(s, { reason: 'REFUSAL' })
    const id = out.requests[0].id
    const results = await s.inT(() => Promise.allSettled([refunds.withdraw(s.tenantId, s.student.id, id), refunds.approve(s.tenantId, s.finance.id, id, 1_000_00n)]))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(failed.reason).toMatchObject({ code: 'refund_state' })
  })

  it('the finance admin finds the student of a letter by name or phone — only students with money to return, phone masked, audited', async () => {
    const s = await paid('rf-search')
    const nobody = await ctx.makeStudent(s.tenantId) // no subscription: never found
    const me = await s.inT(() => db.user.findUniqueOrThrow({ where: { id: s.student.id } }))
    const byName = await s.inT(() => refunds.searchStudents(s.tenantId, s.finance.id, me.displayName))
    expect(byName.items.map((i) => i.id)).toEqual([s.student.id])
    expect(byName.items[0]).toMatchObject({ phoneMasked: expect.stringMatching(/\*\*\*/), subscription: { status: 'ACTIVE', courses: expect.arrayContaining([expect.objectContaining({ courseId: s.course.id })]), payments: [expect.objectContaining({ id: s.payment.id, leftMinor: s.payment.amountMinor.toString() })] } })
    expect(JSON.stringify(byName)).not.toContain(me.phoneE164!)
    // The phone from the letter, typed with spaces.
    const digits = me.phoneE164!.replace('+', '')
    expect((await s.inT(() => refunds.searchStudents(s.tenantId, s.finance.id, `${digits.slice(0, 5)} ${digits.slice(5)}`))).items.map((i) => i.id)).toEqual([s.student.id])
    const nobodyName = (await s.inT(() => db.user.findUniqueOrThrow({ where: { id: nobody.id } }))).displayName
    expect((await s.inT(() => refunds.searchStudents(s.tenantId, s.finance.id, nobodyName))).items).toEqual([])
    await expect(s.inT(() => refunds.searchStudents(s.tenantId, s.finance.id, ' a '))).rejects.toMatchObject({ code: 'validation_failed' })
    expect(await s.inT(() => db.auditEvent.count({ where: { action: 'refund.student_search', entityId: s.finance.id } }))).toBe(3)
    // Only the finance admins (and the Super Admin) reach the search.
    expect(new Reflector().get(ROLES_KEY, RefundsAdminController)).toEqual(['FINANCE_ADMIN'])
  })

  it('reminds the finance admins of a request near its due date', async () => {
    const s = await paid('rf-due')
    const out = await file(s, { reason: 'REFUSAL' })
    await s.inT(() => db.refundRequest.update({ where: { id: out.requests[0].id }, data: { decisionDueAt: new Date(Date.now() + DAY) } }))
    sent.length = 0
    await refunds.remindDue()
    expect(sent.filter((n) => n.type === 'refund.due' && (n.params as { requestId?: string }).requestId === out.requests[0].id).map((n) => n.userIds)).toEqual([[s.finance.id]])
  })
})
