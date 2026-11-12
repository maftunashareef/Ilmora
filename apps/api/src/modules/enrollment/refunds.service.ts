import { maskPhone } from '@ilmora/shared'
import { Injectable, Logger } from '@nestjs/common'
import { AppError } from '../../common/errors'
import { dateColumnToIso, todayLocal } from '../../common/time'
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
/** Students one search of the finance admin returns. */
export const SEARCH_LIMIT = 20

/** Reasons that end the course: the refusal takes effect when it is filed, its seats are freed at once (6.4). */
const ENDS_COURSE = new Set<RefundReason>(['REFUSAL', 'OTHER', 'SCHEDULE_CHANGED', 'GROUP_CLOSED', 'NOT_AS_DESCRIBED'])
/** The center's or the operator's fault: refunded without a deduction for the lessons held (6.5) — lessonsHeld = 0. */
const NO_DEDUCTION = new Set<RefundReason>(['SCHEDULE_CHANGED', 'GROUP_CLOSED', 'NOT_AS_DESCRIBED'])
const OPEN: RefundRequestStatus[] = ['PENDING', 'APPROVED']

/** The finance admin's queue, opened on one request (the site's «Finance» → «Refunds»). */
export const refundQueuePath = (requestId: string) => `/admin/finance?tab=refunds&request=${encodeURIComponent(requestId)}`

/** So'm with spaces between thousands, tiyin after a comma when there are any: «72 000», «45 312,50». */
export const formatSom = (minor: bigint): string => {
  const whole = (minor / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const tiyin = minor % 100n
  return tiyin ? `${whole},${tiyin.toString().padStart(2, '0')}` : whole
}

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
      // One notification per request, with its own amount by 6.4 and a link to it in the queue (a cancellation with the
      // next month paid ahead makes two requests — two notifications, each with its amount).
      if (out.length) {
        const [finance, student] = await Promise.all([this.financeIds(tx, tenantId), tx.user.findFirst({ where: { id: studentId }, select: { displayName: true } })])
        for (const r of out) {
          await this.notifications.notify({
            tenantId, userIds: finance, type: 'refund.requested',
            params: { studentName: student?.displayName ?? '', studentId, requestId: r.id, paymentId: r.paymentId, amountMinor: r.requestedMinor.toString(), amount: formatSom(r.requestedMinor), days: REFUND_DECISION_DAYS, queuePath: refundQueuePath(r.id) },
            dedupeKey: `refund-requested:${r.id}`,
          }, tx)
        }
      }
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

  /**
   * The student takes a request back while it waits for the decision. Not one whose courses this refusal already took
   * off (security review 11.11, №79): withdrawn, it would leave the student with neither the courses nor the money, and
   * no way to ask again — the subscription is gone. Such a request waits for the finance admin's decision.
   */
  async withdraw(tenantId: string, studentId: string, id: string) {
    const done = await this.prisma.tx(async (tx) => {
      const head = await tx.refundRequest.findFirst({ where: { tenantId, id, studentId }, select: { paymentId: true } })
      if (head) await tx.$queryRawUnsafe(`SELECT id FROM "Payment" WHERE id = $1 FOR UPDATE`, head.paymentId)
      if (await this.coursesTakenOff(tx, id)) throw AppError.conflict('refund_courses_removed', 'The courses of this request are already taken off: it cannot be withdrawn, the finance admin decides it')
      return tx.refundRequest.updateMany({ where: { tenantId, id, studentId, status: 'PENDING' }, data: { status: 'WITHDRAWN', openKey: null } })
    })
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

  /**
   * The student a letter is about (6.6), for the finance admin who files the request: search by name, login or phone.
   * Narrow on purpose — not the Super Admin's account list: only students with a paid subscription that still has money
   * to return, at most SEARCH_LIMIT, the phone masked; what the form needs (the courses, the payments and what is left
   * of them) comes with each. Every search is in the audit log.
   */
  async searchStudents(tenantId: string, actorId: string, query: string) {
    const q = query.normalize('NFC').trim()
    if (q.length < 2) throw AppError.invalid('validation_failed', 'At least 2 characters')
    const digits = q.replace(/\D/g, '')
    const match = [
      { displayName: { contains: q, mode: 'insensitive' as const } },
      { login: { contains: q.toLowerCase() } },
      ...(digits.length >= 5 ? [{ phoneE164: { contains: digits } }] : []),
    ]
    const rows = await this.prisma.client.user.findMany({
      where: {
        tenantId, isActive: true, roles: { has: 'STUDENT' }, OR: match,
        subscriptions: { some: { status: { in: ['ACTIVE', 'PAST_DUE'] }, payments: { some: { state: 'PAID', amountMinor: { gt: 0n }, transactions: { none: { sandbox: true } } } } } },
      },
      orderBy: { displayName: 'asc' }, take: SEARCH_LIMIT,
      select: {
        id: true, displayName: true, login: true, phoneE164: true,
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'PAST_DUE'] } }, take: 1, orderBy: { updatedAt: 'desc' },
          select: {
            id: true, kind: true, status: true,
            enrollments: { where: { status: 'ACTIVE' }, select: { id: true, course: { select: { id: true, title: true } } } },
            payments: { where: { state: 'PAID', amountMinor: { gt: 0n } }, orderBy: { periodStart: 'desc' }, select: { id: true, amountMinor: true, refundedMinor: true, periodStart: true, periodEnd: true } },
          },
        },
      },
    })
    await this.audit.record({ tenantId, action: 'refund.student_search', entityType: 'User', entityId: actorId, after: { results: rows.length } })
    return {
      items: rows.map((u) => {
        const sub = u.subscriptions[0]
        return {
          id: u.id, displayName: u.displayName, login: u.login, phoneMasked: u.phoneE164 ? maskPhone(u.phoneE164) : null,
          subscription: sub ? {
            id: sub.id, kind: sub.kind, status: sub.status,
            courses: sub.enrollments.map((e) => ({ enrollmentId: e.id, courseId: e.course.id, title: e.course.title })),
            payments: sub.payments.filter((p) => p.refundedMinor < p.amountMinor).map((p) => ({ id: p.id, amountMinor: p.amountMinor.toString(), leftMinor: (p.amountMinor - p.refundedMinor).toString(), periodStart: p.periodStart, periodEnd: p.periodEnd })),
          } : null,
        }
      }),
    }
  }

  /** A request from a letter (6.6): the finance admin files it for the student; it is counted the same way. */
  async fileFromLetter(tenantId: string, actorId: string, studentId: string, input: RefundInput) {
    return this.refuse(tenantId, studentId, input, { source: 'EMAIL', actorId })
  }

  /** Approved with the amount to return: up to what is left of the payment; it may differ from the count (decisionNote). */
  /**
   * Approves an amount. More than the request asked (by 6.4, for its courses) only with `aboveRequested` and a note
   * saying why (security review 11.11, №101: the whole rest of the payment could be approved for one course, silently).
   */
  async approve(tenantId: string, actorId: string, id: string, approvedMinor: bigint, note?: string, aboveRequested = false) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lockedRequest(tx, tenantId, id)
      if (r.status !== 'PENDING') throw AppError.conflict('refund_state', 'Only a request waiting for the decision can be approved')
      const left = r.payment.amountMinor - r.payment.refundedMinor
      if (approvedMinor <= 0n || approvedMinor > left) throw AppError.invalid('refund_amount', `The amount must be more than 0 and at most ${left}`, { maxMinor: left.toString() })
      // What the request covers: its sum by 6.4 — or, for the operator's fault (6.5 e), where the sum is the finance admin's
      // to decide and counted as 0, the part of the payment its courses make up.
      const covered = r.reason === 'PLATFORM_FAULT'
        ? (await tx.refundRequestLine.aggregate({ where: { refundRequestId: id }, _sum: { priceMinor: true } }))._sum.priceMinor ?? 0n
        : r.requestedMinor
      if (approvedMinor > covered && (!aboveRequested || !note?.trim())) {
        throw AppError.invalid('refund_above_requested', 'More than the request asks for: confirm it and say why in the note', { requestedMinor: covered.toString(), maxMinor: left.toString() })
      }
      // Conditional: a withdrawal committed meanwhile wins, the approval is refused (no APPROVED row without its openKey).
      const done = await tx.refundRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', approvedMinor, decidedAt: new Date(), decidedById: actorId, decisionNote: note?.trim() || null } })
      if (done.count !== 1) throw AppError.conflict('refund_state', 'Only a request waiting for the decision can be approved')
      await this.audit.record({ tx, tenantId, action: 'refund.approved', entityType: 'RefundRequest', entityId: id, after: { approvedMinor: approvedMinor.toString(), requestedMinor: r.requestedMinor.toString(), aboveRequested: approvedMinor > covered }, reason: note })
      await this.notifications.notify({ tenantId, userIds: [r.studentId], type: 'refund.approved', params: { amountMinor: approvedMinor.toString(), requestId: id }, dedupeKey: `refund-approved:${id}` }, tx)
      return { ok: true }
    })
  }

  async reject(tenantId: string, actorId: string, id: string, note: string) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lockedRequest(tx, tenantId, id)
      if (!OPEN.includes(r.status)) throw AppError.conflict('refund_state', 'This request is already closed')
      const done = await tx.refundRequest.updateMany({ where: { id, status: { in: OPEN } }, data: { status: 'REJECTED', openKey: null, decidedAt: new Date(), decidedById: actorId, decisionNote: note.trim() } })
      if (done.count !== 1) throw AppError.conflict('refund_state', 'This request is already closed')
      await this.audit.record({ tx, tenantId, action: 'refund.rejected', entityType: 'RefundRequest', entityId: id, reason: note })
      await this.notifications.notify({ tenantId, userIds: [r.studentId], type: 'refund.rejected', params: { requestId: id, note: note.trim() }, dedupeKey: `refund-rejected:${id}` }, tx)
      return { ok: true }
    })
  }

  /**
   * «Вернуть на рассмотрение» (security review 11.11, №79): a rejected or withdrawn request waits for a decision again —
   * a refusal whose courses were taken off cannot be filed anew (the subscription is gone), so a wrong rejection is put
   * right here. Only while the payment has money left and no other request on it is open; the student is told.
   */
  async reopen(tenantId: string, actorId: string, id: string, note: string, now = new Date()) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lockedRequest(tx, tenantId, id)
      if (r.status !== 'REJECTED' && r.status !== 'WITHDRAWN') throw AppError.conflict('refund_state', 'Only a rejected or withdrawn request can be reopened')
      if (r.payment.amountMinor - r.payment.refundedMinor <= 0n) throw AppError.conflict('refund_amount', 'Nothing is left of the payment to return', { maxMinor: '0' })
      if (await tx.refundRequest.findFirst({ where: { paymentId: r.paymentId, status: { in: OPEN } }, select: { id: true } })) throw AppError.conflict('refund_open', 'A refund request for this payment is already waiting for a decision')
      const done = await tx.refundRequest.updateMany({
        where: { id, status: { in: ['REJECTED', 'WITHDRAWN'] } },
        data: { status: 'PENDING', openKey: r.paymentId, decisionDueAt: new Date(now.getTime() + REFUND_DECISION_DAYS * DAY_MS), decidedAt: null, decidedById: null, decisionNote: null, approvedMinor: null },
      })
      if (done.count !== 1) throw AppError.conflict('refund_state', 'Only a rejected or withdrawn request can be reopened')
      await this.audit.record({ tx, tenantId, action: 'refund.reopened', entityType: 'RefundRequest', entityId: id, before: { status: r.status }, reason: note })
      await this.notifications.notify({ tenantId, userIds: [r.studentId], type: 'refund.reopened', params: { requestId: id }, dedupeKey: `refund-reopened:${id}:${now.getTime()}` }, tx)
      return { ok: true }
    })
  }

  /** The courses of a request that its refusal already took off (their enrollments cancelled). */
  private async coursesTakenOff(tx: TransactionClient, id: string) {
    return (await tx.refundRequestLine.count({ where: { refundRequestId: id, enrollment: { status: 'CANCELLED' } } })) > 0
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
      const now = new Date()
      const claimed = await tx.refundRequest.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PAID', openKey: null, paidAt: now, paidById: actorId, providerRef: providerRef.trim() } })
      if (claimed.count !== 1) throw AppError.conflict('refund_state', 'Only an approved request can be marked as paid')
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
      await tx.payment.update({ where: { id: r.paymentId }, data: { refundedMinor, ...(refundedMinor === r.payment.amountMinor ? { state: 'REFUNDED' as const, refundedAt: now } : {}) } })
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
            params: { studentName: r.student.displayName, requestId: r.id, amount: formatSom(r.approvedMinor ?? r.requestedMinor), dueAt: r.decisionDueAt.toISOString(), overdue: r.decisionDueAt < now, queuePath: refundQueuePath(r.id) },
            dedupeKey: `refund-due:${r.id}:${todayLocal(now)}`,
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
    const sub = await tx.subscription.findFirst({ where: { tenantId, studentId, status: { in: ['ACTIVE', 'PAST_DUE'] } }, include: { package: { select: { lessonCount: true } } } })
    if (!sub) throw AppError.notFound('Subscription')
    const active = await tx.enrollment.findMany({ where: { subscriptionId: sub.id, status: 'ACTIVE' }, include: { group: true, course: { select: { priceMinor: true } } } })
    const ids = input.enrollmentIds?.length ? [...new Set(input.enrollmentIds)] : active.map((e) => e.id)
    const chosen = active.filter((e) => ids.includes(e.id))
    if (!chosen.length || chosen.length !== ids.length) throw AppError.invalid('refund_courses', 'Choose the courses of your subscription')
    const endsCourses = ENDS_COURSE.has(input.reason)
    if (sub.kind === 'LESSONS' && chosen.length !== active.length) throw AppError.invalid('refund_whole_package', 'A lesson package is refused whole: choose all its courses')

    // A payment made with Payme's test key is no money (security review №39): nothing to return from it.
    let payments = await tx.payment.findMany({ where: { subscriptionId: sub.id, state: 'PAID', amountMinor: { gt: 0n }, transactions: { none: { sandbox: true } } }, orderBy: { periodStart: 'desc' }, include: { lines: true } })
    payments = payments.filter((p) => p.refundedMinor < p.amountMinor)
    if (sub.kind !== 'LESSONS') payments = payments.filter((p) => p.periodEnd > now && (endsCourses || p.periodStart <= now))
    // A lesson package: lessons not held do not use up the balance, so «lessons not held» has nothing to return.
    if (sub.kind === 'LESSONS' && input.reason === 'LESSONS_NOT_HELD') payments = []
    // Lesson packages: the unused lessons are returned from the newest payment back — a renewal adds its lessons to
    // those left, so the balance can hold lessons bought by two payments.
    let unusedLessons = Math.max(0, (sub.lessonsTotal ?? 0) - sub.lessonsUsed)
    // The lessons each payment bought (№78); a payment from before Payment.lessonsBought — the package's count.
    const boughtBy = (p: { lessonsBought: number | null }) => Math.max(1, p.lessonsBought ?? sub.package?.lessonCount ?? sub.lessonsTotal ?? 1)

    const requests: PlannedRequest[] = []
    for (const p of payments) {
      // What the payment paid for each chosen course.
      let parts: { enrollmentId: string; courseId: string; priceMinor: bigint }[]
      if (p.lines.length) {
        parts = p.lines.filter((l) => l.enrollmentId && ids.includes(l.enrollmentId)).map((l) => ({ enrollmentId: l.enrollmentId!, courseId: l.courseId, priceMinor: l.amountMinor }))
      } else {
        // A payment from before PaymentLine: split over the courses it paid for — those the subscription had when it was
        // paid, including ones refused since — by their prices, not over the courses left now.
        const paidAt = p.paidAt ?? p.createdAt
        const covered = (await tx.enrollment.findMany({ where: { subscriptionId: sub.id, createdAt: { lte: paidAt } }, include: { course: { select: { priceMinor: true } } }, orderBy: { createdAt: 'asc' } }))
          .filter((e) => e.status === 'ACTIVE' || (e.cancelledAt !== null && e.cancelledAt > paidAt))
        const split = splitByPrice(p.amountMinor, covered.map((e) => e.course.priceMinor))
        parts = covered.map((e, i) => ({ enrollmentId: e.id, courseId: e.courseId, priceMinor: split[i] })).filter((x) => ids.includes(x.enrollmentId))
      }
      // What earlier paid requests already returned for a course from this payment comes off this count. The amount is
      // what the finance admin actually paid (approvedMinor), spread over that request's lines.
      const earlier = await tx.refundRequest.findMany({ where: { tenantId, paymentId: p.id, status: 'PAID' }, select: { approvedMinor: true, lines: { select: { enrollmentId: true, amountMinor: true } } } })
      const returnedBy = new Map<string, bigint>()
      for (const r of earlier) {
        const paid = r.approvedMinor ?? 0n
        const sum = r.lines.reduce((a, l) => a + l.amountMinor, 0n)
        r.lines.forEach((l, i) => {
          let part = sum > 0n ? (paid * l.amountMinor) / sum : paid / BigInt(r.lines.length)
          if (i === r.lines.length - 1) part = paid - r.lines.slice(0, -1).reduce((a, x) => a + (sum > 0n ? (paid * x.amountMinor) / sum : paid / BigInt(r.lines.length)), 0n)
          returnedBy.set(l.enrollmentId, (returnedBy.get(l.enrollmentId) ?? 0n) + part)
        })
      }
      const returned = (enrollmentId: string) => returnedBy.get(enrollmentId) ?? 0n

      // A lesson package: this payment's lessons and how many of them are still unused.
      const boughtPerPayment = boughtBy(p)
      const packageTake = Math.min(unusedLessons, boughtPerPayment)
      if (sub.kind === 'LESSONS') unusedLessons -= packageTake

      const lines: PlannedLine[] = []
      for (const part of parts) {
        const enrollment = chosen.find((e) => e.id === part.enrollmentId)!
        let lessonsTotal: number
        let held: number
        if (sub.kind === 'LESSONS') {
          lessonsTotal = boughtPerPayment
          held = boughtPerPayment - packageTake
          // The center's fault on a package: the lessons still unused in this payment come back whole.
          if (NO_DEDUCTION.has(input.reason) && packageTake === 0) held = lessonsTotal
        } else {
          const c = await this.countFor(tx, enrollment.group, p.periodStart, p.periodEnd, now)
          lessonsTotal = c.total
          // Lessons the center did not hold (6.5 b): the course goes on, the money of those lessons comes back.
          held = input.reason === 'LESSONS_NOT_HELD' ? c.total - c.notHeld : c.held
        }
        if (NO_DEDUCTION.has(input.reason) && (sub.kind !== 'LESSONS' || packageTake > 0)) held = 0
        // The operator's fault (6.5 e): the part is the finance admin's decision — counted as 0, decided on approval.
        if (input.reason === 'PLATFORM_FAULT') held = lessonsTotal
        const share = refundShare(part.priceMinor, lessonsTotal, held) - returned(part.enrollmentId)
        const amountMinor = share < 0n ? 0n : share > part.priceMinor ? part.priceMinor : share
        lines.push({ ...part, lessonsTotal, lessonsHeld: Math.min(Math.max(held, 0), lessonsTotal), amountMinor })
      }
      if (!lines.length) continue
      const counted = lines.reduce((s, l) => s + l.amountMinor, 0n)
      const left = p.amountMinor - p.refundedMinor
      const requestedMinor = counted > left ? left : counted
      if (requestedMinor === 0n && input.reason !== 'PLATFORM_FAULT') continue
      requests.push({ paymentId: p.id, requestedMinor, currency: p.currency, lines })
      // The operator's fault is decided once, on the current payment.
      if (input.reason === 'PLATFORM_FAULT') break
    }
    return { subscriptionId: sub.id, kind: sub.kind, endsCourses, enrollmentIds: chosen.map((e) => e.id), requests }
  }

  private async countFor(tx: TransactionClient, group: { id: string; days: number[]; startTime: string; timezone: string }, periodStart: Date, periodEnd: Date, at: Date) {
    const select = { id: true, startsAt: true, status: true, rescheduledFromId: true } as const
    const [inPeriod, last] = await Promise.all([
      tx.lessonSession.findMany({ where: { groupId: group.id, startsAt: { gte: periodStart, lt: periodEnd } }, select }),
      // The weekly calendar ends at the last generated lesson; a one-off or moved lesson far ahead does not end it.
      tx.lessonSession.findFirst({ where: { groupId: group.id, isExtra: false, rescheduledFromId: null }, orderBy: { date: 'desc' }, select: { date: true } }),
    ])
    // A lesson of the period moved out of it is held at its new date: the lesson that points back at it is fetched too,
    // so the cancelled original is not taken for a lesson the center did not hold.
    const cancelledIds = inPeriod.filter((s) => s.status === 'CANCELLED').map((s) => s.id)
    const movedOut = cancelledIds.length ? await tx.lessonSession.findMany({ where: { groupId: group.id, rescheduledFromId: { in: cancelledIds }, NOT: { startsAt: { gte: periodStart, lt: periodEnd } } }, select }) : []
    return countLessons({ periodStart, periodEnd, at, sessions: [...inPeriod, ...movedOut], lastCalendarDate: last ? dateColumnToIso(last.date) : null, weekly: { days: group.days, startTime: group.startTime, timezone: group.timezone } })
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
