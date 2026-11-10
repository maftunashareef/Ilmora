import { Injectable, Logger } from '@nestjs/common'
import { AppError } from '../../common/errors'
import { dateColumnToIso } from '../../common/time'
import type { RefundReason, RefundRequestStatus, RefundSource } from '../../generated/prisma/enums'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { LedgerService } from '../payments/ledger.service'
import { countLessons, refundShare, splitByPrice } from './refund-count'
import { SubscriptionService } from './subscription.service'

const DAY_MS = 86_400_000
/** The decision is due within 10 calendar days of the request (offer 6.6). */
export const REFUND_DECISION_DAYS = 10
/** The finance admins are reminded this many days before the due date. */
export const REFUND_REMIND_DAYS = 2

/** Reasons that end the course: the refusal takes effect when it is filed, its seats are freed at once (6.4). */
const ENDS_COURSE = new Set<RefundReason>(['REFUSAL', 'OTHER', 'SCHEDULE_CHANGED', 'GROUP_CLOSED', 'NOT_AS_DESCRIBED'])
/** The center's or the operator's fault: refunded without a deduction for the lessons held (6.5) — lessonsHeld = 0. */
const NO_DEDUCTION = new Set<RefundReason>(['SCHEDULE_CHANGED', 'GROUP_CLOSED', 'NOT_AS_DESCRIBED'])
const OPEN: RefundRequestStatus[] = ['PENDING', 'APPROVED']

export interface RefundInput {
  /** The courses (enrollments) refused; all the subscription's courses when absent. */
  enrollmentIds?: string[]
  reason: RefundReason
  reasonText?: string
  toOtherAccount?: boolean
}

interface PlannedLine { enrollmentId: string; courseId: string; priceMinor: bigint; lessonsTotal: number; lessonsHeld: number; amountMinor: bigint }
interface PlannedRequest { paymentId: string; requestedMinor: bigint; currency: string; lines: PlannedLine[] }
interface Plan { subscriptionId: string; kind: string; endsCourses: boolean; enrollmentIds: string[]; requests: PlannedRequest[] }

/**
 * Refund requests (offer 6.3–6.6, security review 10.11 №42; tables by Timur's migration 20261117000000).
 *
 * The student files one from the cabinet, or a finance admin enters one from a letter. Each paid payment that still has
 * money to return gets its own request (a cancellation with the next month paid ahead: the current month by the
 * formula of 6.4, the next one whole). The finance admin approves with an amount or rejects with a reason, then marks
 * the money sent: the payment's refundedMinor grows, a PAYMENT_REFUNDED journal is posted under the request, and when
 * everything is returned the payment becomes REFUNDED. Payme cancels only whole transactions, so a partial refund is a
 * bank transfer; a whole one may also go through Payme's cabinet (PaymentsService.refundPaid closes the request then).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ledger: LedgerService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  // ───────── the student ─────────

  /** What a request would return, before it is filed (the site shows it on the form). Nothing is written. */
  async quote(tenantId: string, studentId: string, input: RefundInput, now = new Date()) {
    const plan = await this.plan(this.prisma.client as unknown as TransactionClient, tenantId, studentId, input, now)
    return { endsCourses: plan.endsCourses, requests: plan.requests.map((r) => ({ paymentId: r.paymentId, requestedMinor: r.requestedMinor.toString(), currency: r.currency, lines: r.lines.map(lineDto) })) }
  }

  /**
   * Files the refusal: a request per payment with money to return, and — for a reason that ends the course — the seats
   * are freed at once; with no course left the subscription is cancelled.
   */
  async refuse(tenantId: string, studentId: string, input: RefundInput, by: { source: RefundSource; actorId: string }, now = new Date()) {
    if (input.reason === 'OTHER' && !input.reasonText?.trim()) throw AppError.invalid('refund_reason_text', 'Describe the reason')
    const created = await this.prisma.tx(async (tx) => {
      const sub = await tx.subscription.findFirst({ where: { tenantId, studentId, status: { in: ['ACTIVE', 'PAST_DUE'] } }, select: { id: true } })
      if (!sub) throw AppError.notFound('Subscription')
      // The payments are locked in the order settle() and cancelIn() take them: requests and settlements serialize.
      await tx.$queryRawUnsafe(`SELECT id FROM "Payment" WHERE "subscriptionId" = $1 FOR UPDATE`, sub.id)
      const plan = await this.plan(tx, tenantId, studentId, input, now)
      const out: { id: string; paymentId: string; requestedMinor: bigint }[] = []
      for (const r of plan.requests) {
        const open = await tx.refundRequest.findFirst({ where: { paymentId: r.paymentId, status: { in: OPEN } }, select: { id: true } })
        if (open) throw AppError.conflict('refund_open', 'A refund request for this payment is already waiting for a decision')
        const row = await tx.refundRequest.create({
          data: {
            tenantId, studentId, subscriptionId: plan.subscriptionId, paymentId: r.paymentId, reason: input.reason, reasonText: input.reasonText?.trim() || null,
            source: by.source, toOtherAccount: input.toOtherAccount ?? false, requestedMinor: r.requestedMinor, currency: r.currency,
            decisionDueAt: new Date(now.getTime() + REFUND_DECISION_DAYS * DAY_MS), openKey: r.paymentId, createdById: by.actorId,
            lines: { create: r.lines.map((l) => ({ tenantId, ...l })) },
          },
        })
        out.push(row)
        await this.audit.record({ tx, tenantId, action: 'refund.requested', entityType: 'RefundRequest', entityId: row.id, after: { paymentId: r.paymentId, requestedMinor: r.requestedMinor.toString(), reason: input.reason, source: by.source, enrollmentIds: plan.enrollmentIds }, reason: input.reasonText })
      }
      if (plan.endsCourses) await this.endCourses(tx, plan, input, now)
      if (out.length) await this.notifyFinance(tx, tenantId, studentId, out.map((r) => r.id))
      return { requests: out, endsCourses: plan.endsCourses }
    })
    return { ok: true, endsCourses: created.endsCourses, requests: created.requests.map((r) => ({ id: r.id, paymentId: r.paymentId, requestedMinor: r.requestedMinor.toString() })) }
  }

  /** «Cancel» in the cabinet: a paid subscription is refused whole (6.3–6.4); an unpaid checkout is just cancelled. */
  async cancelSubscription(tenantId: string, studentId: string, reasonText?: string) {
    const paid = await this.prisma.client.subscription.findFirst({ where: { tenantId, studentId, status: { in: ['ACTIVE', 'PAST_DUE'] } }, select: { id: true } })
    if (!paid) return this.subscriptions.cancel(tenantId, studentId, reasonText)
    const r = await this.refuse(tenantId, studentId, { reason: 'REFUSAL', reasonText }, { source: 'CABINET', actorId: studentId })
    return { ok: true, refundRequested: r.requests.length > 0, refundRequests: r.requests }
  }

  async listMine(tenantId: string, studentId: string) {
    const rows = await this.prisma.client.refundRequest.findMany({ where: { tenantId, studentId }, orderBy: { createdAt: 'desc' }, take: 50, include: { lines: { include: { course: { select: { title: true } } } } } })
    return rows.map((r) => requestDto(r))
  }

  /** The student takes a request back while it waits for the decision. Freed seats are not given back. */
  async withdraw(tenantId: string, studentId: string, id: string) {
    const done = await this.prisma.client.refundRequest.updateMany({ where: { tenantId, id, studentId, status: 'PENDING' }, data: { status: 'WITHDRAWN', openKey: null } })
    if (done.count !== 1) throw AppError.conflict('refund_state', 'This request can no longer be withdrawn')
    await this.audit.record({ tenantId, action: 'refund.withdrawn', entityType: 'RefundRequest', entityId: id })
    return { ok: true }
  }

  // ───────── the finance admin ─────────

  async list(tenantId: string, q: { status?: RefundRequestStatus; overdue?: boolean; page?: number; pageSize?: number }, now = new Date()) {
    const page = Math.max(1, q.page ?? 1)
    const pageSize = Math.min(100, Math.max(10, q.pageSize ?? 30))
    const where = { tenantId, ...(q.status ? { status: q.status } : {}), ...(q.overdue ? { status: { in: OPEN }, decisionDueAt: { lt: now } } : {}) }
    const [rows, total] = await Promise.all([
      this.prisma.client.refundRequest.findMany({
        where, orderBy: [{ decisionDueAt: 'asc' }, { createdAt: 'asc' }], skip: (page - 1) * pageSize, take: pageSize,
        include: { lines: { include: { course: { select: { title: true } } } }, student: { select: { id: true, displayName: true } }, payment: { select: { id: true, amountMinor: true, refundedMinor: true, provider: true, paidAt: true, periodStart: true, periodEnd: true, state: true } } },
      }),
      this.prisma.client.refundRequest.count({ where }),
    ])
    return {
      page, pageSize, total,
      items: rows.map((r) => ({
        ...requestDto(r),
        overdue: OPEN.includes(r.status) && r.decisionDueAt < now,
        student: r.student,
        payment: { ...r.payment, amountMinor: r.payment.amountMinor.toString(), refundedMinor: r.payment.refundedMinor.toString() },
      })),
    }
  }

  /** A request from a letter (6.6): the finance admin files it for the student; it is counted the same way. */
  async fileFromLetter(tenantId: string, actorId: string, studentId: string, input: RefundInput) {
    return this.refuse(tenantId, studentId, input, { source: 'EMAIL', actorId })
  }

  /** Approved with the amount to return: up to what is left of the payment; it may differ from the count (decisionNote). */
  async approve(tenantId: string, actorId: string, id: string, approvedMinor: bigint, note?: string) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lockedRequest(tx, tenantId, id)
      if (r.status !== 'PENDING') throw AppError.conflict('refund_state', 'Only a request waiting for the decision can be approved')
      const left = r.payment.amountMinor - r.payment.refundedMinor
      if (approvedMinor <= 0n || approvedMinor > left) throw AppError.invalid('refund_amount', `The amount must be more than 0 and at most ${left}`, { maxMinor: left.toString() })
      await tx.refundRequest.update({ where: { id }, data: { status: 'APPROVED', approvedMinor, decidedAt: new Date(), decidedById: actorId, decisionNote: note?.trim() || null } })
      await this.audit.record({ tx, tenantId, action: 'refund.approved', entityType: 'RefundRequest', entityId: id, after: { approvedMinor: approvedMinor.toString(), requestedMinor: r.requestedMinor.toString() }, reason: note })
      await this.notifications.notify({ tenantId, userIds: [r.studentId], type: 'refund.approved', params: { amountMinor: approvedMinor.toString(), requestId: id }, dedupeKey: `refund-approved:${id}` }, tx)
      return { ok: true }
    })
  }

  async reject(tenantId: string, actorId: string, id: string, note: string) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lockedRequest(tx, tenantId, id)
      if (!OPEN.includes(r.status)) throw AppError.conflict('refund_state', 'This request is already closed')
      await tx.refundRequest.update({ where: { id }, data: { status: 'REJECTED', openKey: null, decidedAt: new Date(), decidedById: actorId, decisionNote: note.trim() } })
      await this.audit.record({ tx, tenantId, action: 'refund.rejected', entityType: 'RefundRequest', entityId: id, reason: note })
      await this.notifications.notify({ tenantId, userIds: [r.studentId], type: 'refund.rejected', params: { requestId: id, note: note.trim() }, dedupeKey: `refund-rejected:${id}` }, tx)
      return { ok: true }
    })
  }

  /**
   * The money was sent (a bank transfer, or Payme): the payment's refundedMinor grows by the approved amount, a
   * PAYMENT_REFUNDED journal is posted under the request (a reversal would undo the whole payment, and only once), and
   * with everything returned the payment becomes REFUNDED.
   */
  async markPaid(tenantId: string, actorId: string, id: string, providerRef: string) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lockedRequest(tx, tenantId, id)
      if (r.status !== 'APPROVED' || r.approvedMinor == null) throw AppError.conflict('refund_state', 'Only an approved request can be marked as paid')
      const left = r.payment.amountMinor - r.payment.refundedMinor
      if (r.approvedMinor > left) throw AppError.conflict('refund_amount', 'More than is left of the payment', { maxMinor: left.toString() })
      const provider = (r.payment.provider ?? 'MANUAL').toLowerCase()
      await this.ledger.post(tx, {
        tenantId, kind: 'PAYMENT_REFUNDED', referenceType: 'RefundRequest', referenceId: r.id, createdById: actorId, reason: providerRef,
        description: `Refund ${r.id} of payment ${r.paymentId} (${providerRef})`,
        entries: [
          { account: 'revenue:subscriptions', accountType: 'SUBSCRIPTION_REVENUE', direction: 'DEBIT', amountMinor: r.approvedMinor },
          { account: `clearing:${provider}`, accountType: 'PROVIDER_CLEARING', direction: 'CREDIT', amountMinor: r.approvedMinor },
        ],
      })
      const refundedMinor = r.payment.refundedMinor + r.approvedMinor
      const now = new Date()
      await tx.payment.update({ where: { id: r.paymentId }, data: { refundedMinor, ...(refundedMinor === r.payment.amountMinor ? { state: 'REFUNDED' as const, refundedAt: now } : {}) } })
      await tx.refundRequest.update({ where: { id }, data: { status: 'PAID', openKey: null, paidAt: now, paidById: actorId, providerRef: providerRef.trim() } })
      await this.audit.record({ tx, tenantId, action: 'refund.paid', entityType: 'RefundRequest', entityId: id, after: { amountMinor: r.approvedMinor.toString(), paymentRefundedMinor: refundedMinor.toString(), providerRef } })
      await this.notifications.notify({ tenantId, userIds: [r.studentId], type: 'refund.paid', params: { amountMinor: r.approvedMinor.toString(), requestId: id }, dedupeKey: `refund-paid:${id}` }, tx)
      return { ok: true, paymentRefundedMinor: refundedMinor.toString(), paymentState: refundedMinor === r.payment.amountMinor ? 'REFUNDED' : r.payment.state }
    })
  }

  /** Daily: requests still open within REFUND_REMIND_DAYS of their due date (or past it) remind the finance admins. */
  async remindDue(now = new Date()) {
    let reminded = 0
    const tenants = await TenantContext.system(() => this.prisma.client.tenant.findMany({ select: { id: true } }))
    for (const t of tenants) {
      await TenantContext.forTenant(t.id, async () => {
        const due = await this.prisma.client.refundRequest.findMany({ where: { tenantId: t.id, status: { in: OPEN }, decisionDueAt: { lte: new Date(now.getTime() + REFUND_REMIND_DAYS * DAY_MS) } }, include: { student: { select: { displayName: true } } } })
        if (!due.length) return
        const finance = await this.financeIds(this.prisma.client as unknown as TransactionClient, t.id)
        for (const r of due) {
          reminded += await this.notifications.notify({
            tenantId: t.id, userIds: finance, type: 'refund.due',
            params: { studentName: r.student.displayName, requestId: r.id, dueAt: r.decisionDueAt.toISOString(), overdue: r.decisionDueAt < now },
            dedupeKey: `refund-due:${r.id}:${now.toISOString().slice(0, 10)}`,
          }) > 0 ? 1 : 0
        }
      })
    }
    if (reminded) this.logger.log(`Refund reminders sent for ${reminded} request(s)`)
    return { reminded }
  }

  // ───────── the count ─────────

  /**
   * Which payments get a request and for how much. A payment counts while it has money left to return and its period has
   * not ended (a period paid ahead is returned whole: none of its lessons was held — 6.3). Each course's part comes from
   * PaymentLine (what that payment paid for it); a payment made before PaymentLine is split by the courses' prices.
   * Lesson packages: the lessons are counted on the whole subscription, so only the whole subscription is refused and
   * every course gets the same share — unused ÷ all lessons — of its part of the latest payment.
   */
  private async plan(tx: TransactionClient, tenantId: string, studentId: string, input: RefundInput, now: Date): Promise<Plan> {
    const sub = await tx.subscription.findFirst({ where: { tenantId, studentId, status: { in: ['ACTIVE', 'PAST_DUE'] } } })
    if (!sub) throw AppError.notFound('Subscription')
    const active = await tx.enrollment.findMany({ where: { subscriptionId: sub.id, status: 'ACTIVE' }, include: { group: true, course: { select: { priceMinor: true } } } })
    const ids = input.enrollmentIds?.length ? [...new Set(input.enrollmentIds)] : active.map((e) => e.id)
    const chosen = active.filter((e) => ids.includes(e.id))
    if (!chosen.length || chosen.length !== ids.length) throw AppError.invalid('refund_courses', 'Choose the courses of your subscription')
    const endsCourses = ENDS_COURSE.has(input.reason)
    if (sub.kind === 'LESSONS' && chosen.length !== active.length) throw AppError.invalid('refund_whole_package', 'A lesson package is refused whole: choose all its courses')

    let payments = await tx.payment.findMany({ where: { subscriptionId: sub.id, state: 'PAID', amountMinor: { gt: 0n } }, orderBy: { periodStart: 'desc' }, include: { lines: true } })
    payments = payments.filter((p) => p.refundedMinor < p.amountMinor)
    if (sub.kind === 'LESSONS') payments = payments.slice(0, 1)
    else payments = payments.filter((p) => p.periodEnd > now && (endsCourses || p.periodStart <= now))

    const requests: PlannedRequest[] = []
    for (const p of payments) {
      // What the payment paid for each chosen course.
      let parts: { enrollmentId: string; courseId: string; priceMinor: bigint }[]
      if (p.lines.length) {
        parts = p.lines.filter((l) => l.enrollmentId && ids.includes(l.enrollmentId)).map((l) => ({ enrollmentId: l.enrollmentId!, courseId: l.courseId, priceMinor: l.amountMinor }))
      } else {
        const split = splitByPrice(p.amountMinor, active.map((e) => e.course.priceMinor))
        parts = active.map((e, i) => ({ enrollmentId: e.id, courseId: e.courseId, priceMinor: split[i] })).filter((x) => ids.includes(x.enrollmentId))
      }
      // What an earlier request already returned for a course from this payment (lessons not held, 6.5 b) is not
      // returned twice: it comes off this count.
      const earlier = await tx.refundRequestLine.findMany({ where: { enrollmentId: { in: parts.map((x) => x.enrollmentId) }, refundRequest: { tenantId, paymentId: p.id, status: 'PAID' } }, select: { enrollmentId: true, amountMinor: true } })
      const returned = (enrollmentId: string) => earlier.filter((e) => e.enrollmentId === enrollmentId).reduce((s, e) => s + e.amountMinor, 0n)

      const lines: PlannedLine[] = []
      for (const part of parts) {
        const enrollment = chosen.find((e) => e.id === part.enrollmentId)!
        let lessonsTotal: number
        let held: number
        if (sub.kind === 'LESSONS') {
          lessonsTotal = Math.max(0, sub.lessonsTotal ?? 0)
          held = Math.min(lessonsTotal, sub.lessonsUsed)
        } else {
          const c = await this.countFor(tx, enrollment.group, p.periodStart, p.periodEnd, now)
          lessonsTotal = c.total
          // Lessons the center did not hold (6.5 b): the course goes on, the money of those lessons comes back.
          held = input.reason === 'LESSONS_NOT_HELD' ? c.total - c.notHeld : c.held
        }
        if (NO_DEDUCTION.has(input.reason)) held = 0
        // The operator's fault (6.5 e): the part is the finance admin's decision — counted as 0, decided on approval.
        if (input.reason === 'PLATFORM_FAULT') held = lessonsTotal
        const share = refundShare(part.priceMinor, lessonsTotal, held) - returned(part.enrollmentId)
        const amountMinor = share < 0n ? 0n : share > part.priceMinor ? part.priceMinor : share
        lines.push({ ...part, lessonsTotal, lessonsHeld: Math.min(held, lessonsTotal), amountMinor })
      }
      if (!lines.length) continue
      const counted = lines.reduce((s, l) => s + l.amountMinor, 0n)
      const left = p.amountMinor - p.refundedMinor
      const requestedMinor = counted > left ? left : counted
      if (requestedMinor === 0n && input.reason !== 'PLATFORM_FAULT') continue
      requests.push({ paymentId: p.id, requestedMinor, currency: p.currency, lines })
    }
    return { subscriptionId: sub.id, kind: sub.kind, endsCourses, enrollmentIds: chosen.map((e) => e.id), requests }
  }

  private async countFor(tx: TransactionClient, group: { id: string; days: number[]; startTime: string; timezone: string }, periodStart: Date, periodEnd: Date, at: Date) {
    const [inPeriod, last] = await Promise.all([
      tx.lessonSession.findMany({ where: { groupId: group.id, startsAt: { gte: periodStart, lt: periodEnd } }, select: { id: true, startsAt: true, status: true, rescheduledFromId: true } }),
      tx.lessonSession.findFirst({ where: { groupId: group.id }, orderBy: { date: 'desc' }, select: { date: true } }),
    ])
    return countLessons({ periodStart, periodEnd, at, sessions: inPeriod, lastCalendarDate: last ? dateColumnToIso(last.date) : null, weekly: { days: group.days, startTime: group.startTime, timezone: group.timezone } })
  }

  /** The refused courses end now; a renewal waiting for payment is cancelled (its amount still has them); no course left — the subscription ends. */
  private async endCourses(tx: TransactionClient, plan: Plan, input: RefundInput, now: Date) {
    await tx.enrollment.updateMany({ where: { id: { in: plan.enrollmentIds }, status: 'ACTIVE' }, data: { status: 'CANCELLED', cancelledAt: now } })
    const left = await tx.enrollment.count({ where: { subscriptionId: plan.subscriptionId, status: 'ACTIVE' } })
    if (left === 0) {
      await this.subscriptions.cancelIn(tx, plan.subscriptionId, ['ACTIVE', 'PAST_DUE'], input.reasonText ?? input.reason, now)
      return
    }
    await tx.payment.updateMany({ where: { subscriptionId: plan.subscriptionId, state: 'PENDING' }, data: { state: 'CANCELLED', cancelledAt: now } })
    await this.audit.record({ tx, action: 'subscription.courses_refused', entityType: 'Subscription', entityId: plan.subscriptionId, after: { enrollmentIds: plan.enrollmentIds, reason: input.reason } })
  }

  private async lockedRequest(tx: TransactionClient, tenantId: string, id: string) {
    const head = await tx.refundRequest.findFirst({ where: { tenantId, id }, select: { paymentId: true } })
    if (!head) throw AppError.notFound('Refund request')
    await tx.$queryRawUnsafe(`SELECT id FROM "Payment" WHERE id = $1 FOR UPDATE`, head.paymentId)
    const r = await tx.refundRequest.findFirst({ where: { tenantId, id }, include: { payment: { select: { amountMinor: true, refundedMinor: true, provider: true, state: true } } } })
    if (!r) throw AppError.notFound('Refund request')
    return r
  }

  private financeIds(db: TransactionClient, tenantId: string) {
    return db.user.findMany({ where: { tenantId, isActive: true, OR: [{ roles: { has: 'FINANCE_ADMIN' } }, { isOwner: true }] }, select: { id: true } }).then((u) => u.map((x) => x.id))
  }

  private async notifyFinance(tx: TransactionClient, tenantId: string, studentId: string, requestIds: string[]) {
    const [finance, student] = await Promise.all([this.financeIds(tx, tenantId), tx.user.findFirst({ where: { id: studentId }, select: { displayName: true } })])
    await this.notifications.notify({ tenantId, userIds: finance, type: 'refund.requested', params: { studentName: student?.displayName ?? '', studentId, requestIds, days: REFUND_DECISION_DAYS }, dedupeKey: `refund-requested:${requestIds.join(',')}` }, tx)
  }
}


type RequestRow = {
  id: string; status: RefundRequestStatus; reason: RefundReason; reasonText: string | null; source: RefundSource; toOtherAccount: boolean
  paymentId: string; subscriptionId: string; requestedMinor: bigint; approvedMinor: bigint | null; currency: string; decisionDueAt: Date
  decidedAt: Date | null; decisionNote: string | null; paidAt: Date | null; providerRef: string | null; createdAt: Date
  lines: { enrollmentId: string; courseId: string; priceMinor: bigint; lessonsTotal: number; lessonsHeld: number; amountMinor: bigint; course?: { title: unknown } }[]
}

function lineDto(l: { enrollmentId: string; courseId: string; priceMinor: bigint; lessonsTotal: number; lessonsHeld: number; amountMinor: bigint; course?: { title: unknown } }) {
  return { enrollmentId: l.enrollmentId, courseId: l.courseId, courseTitle: l.course?.title ?? null, priceMinor: l.priceMinor.toString(), lessonsTotal: l.lessonsTotal, lessonsHeld: l.lessonsHeld, amountMinor: l.amountMinor.toString() }
}

function requestDto(r: RequestRow) {
  return {
    id: r.id, status: r.status, reason: r.reason, reasonText: r.reasonText, source: r.source, toOtherAccount: r.toOtherAccount,
    paymentId: r.paymentId, subscriptionId: r.subscriptionId, requestedMinor: r.requestedMinor.toString(), approvedMinor: r.approvedMinor?.toString() ?? null,
    currency: r.currency, decisionDueAt: r.decisionDueAt, decidedAt: r.decidedAt, decisionNote: r.decisionNote, paidAt: r.paidAt, providerRef: r.providerRef, createdAt: r.createdAt,
    lines: r.lines.map(lineDto),
  }
}
