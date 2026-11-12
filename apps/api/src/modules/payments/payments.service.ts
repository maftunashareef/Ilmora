import { Inject, Injectable, Logger } from '@nestjs/common'
import { AppError } from '../../common/errors'
import { ENV, type Env, paymeConfigured } from '../../config/env'
import type { PaymentProvider, PaymentState } from '../../generated/prisma/enums'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { CALLBACK_LOG_DAYS, UNPROVEN_CALLBACK_LOG_DAYS } from './callback-log-budget'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { isClosed, SubscriptionService } from '../enrollment/subscription.service'
import { LedgerService } from './ledger.service'
import { OutboxService } from './outbox.service'

export interface SettleInput {
  paymentId: string
  provider: PaymentProvider
  providerTransactionId: string
  performedAt: Date
  actorId?: string
  /** Paid with Payme's test key: the payment activates the order, but books no revenue and sends no receipt (№39). */
  sandbox?: boolean
}

/**
 * Payment lifecycle shared by every provider adapter. All state transitions run inside a transaction that
 * locks the Payment row, so concurrent or repeated callbacks serialize and converge on one outcome.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly subscriptions: SubscriptionService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  providersAvailable() {
    // Payme only: Click was removed (decision 10.11, security review №5, №6).
    return { PAYME: paymeConfigured(this.env) }
  }

  /** Builds the hosted-checkout URL for a pending payment (no card data ever touches ILMORA). */
  checkoutLink(payment: { id: string; amountMinor: bigint; provider: PaymentProvider | null; expiresAt: Date }, provider: 'PAYME', lang: 'uz' | 'ru' | 'en') {
    // Nothing to collect: the checkout settled on the spot, so there is no provider page to send the student to.
    if (payment.amountMinor === 0n) return { paymentId: payment.id, provider: null, url: null, expiresAt: payment.expiresAt, free: true as const }
    const returnUrl = `${this.env.PUBLIC_WEB_URL}/${lang}/payments/${payment.id}/return`
    if (!paymeConfigured(this.env)) throw AppError.unavailable('Payme is not configured yet')
    const params = `m=${this.env.PAYME_MERCHANT_ID};ac.payment_id=${payment.id};a=${payment.amountMinor.toString()};l=${lang};c=${returnUrl}`
    const url = `${this.env.PAYME_CHECKOUT_URL.replace(/\/$/, '')}/${Buffer.from(params, 'utf8').toString('base64')}`
    return { paymentId: payment.id, provider, url, expiresAt: payment.expiresAt, free: false as const }
  }

  async lockPayment(tx: TransactionClient, paymentId: string) {
    await tx.$queryRawUnsafe(`SELECT id FROM "Payment" WHERE id = $1 FOR UPDATE`, paymentId)
    return tx.payment.findFirst({ where: { id: paymentId } })
  }

  /**
   * Why `payment` cannot be settled right now, or null when it can. The adapters ask before accepting or performing a
   * provider transaction, so no debit is taken for an order that can no longer be fulfilled: hold expired or cancelled,
   * already paid through the other provider, or a subscription that is closed for good.
   */
  async settleBlocker(db: TransactionClient | PrismaService['client'], payment: { id?: string; state: PaymentState; subscriptionId: string; periodStart?: Date; periodEnd?: Date }): Promise<'payment_not_pending' | 'subscription_closed' | 'period_already_paid' | null> {
    if (payment.state !== 'PENDING') return 'payment_not_pending'
    const sub = await db.subscription.findFirst({ where: { id: payment.subscriptionId }, select: { status: true, kind: true } })
    if (!sub || isClosed(sub.status)) return 'subscription_closed'
    // A month is paid once: an invoice for a period another paid invoice already covers is refused, so the provider
    // returns the money instead of taking it for nothing — whatever made the second invoice (Н6 / review 11.11 №80).
    // Lesson packages are bought by lessons, not by months: two of them may overlap in time.
    if (sub.kind === 'PERIOD' && payment.id && payment.periodStart && payment.periodEnd) {
      const overlap = await db.payment.count({ where: { subscriptionId: payment.subscriptionId, id: { not: payment.id }, state: 'PAID', periodStart: { lt: payment.periodEnd }, periodEnd: { gt: payment.periodStart } } })
      if (overlap) return 'period_already_paid'
    }
    // A course archived, a center blocked or a group deleted since the order: no money for lessons that will not
    // happen (security review №9) — the provider refuses, the student chooses again.
    const closed = await db.enrollment.count({
      where: {
        subscriptionId: payment.subscriptionId, status: { in: ['PENDING', 'ACTIVE'] },
        OR: [{ group: { deletedAt: { not: null } } }, { group: { course: { status: { not: 'PUBLISHED' } } } }, { group: { course: { center: { status: { not: 'ACTIVE' } } } } }],
      },
    })
    return closed ? 'subscription_closed' : null
  }

  /**
   * Mark a payment as paid exactly once: activates the subscription, posts the ledger journal and queues the
   * receipt through the outbox — all in the caller's transaction. Returns false if it was already paid.
   */
  async settle(tx: TransactionClient, input: SettleInput): Promise<{ applied: boolean; paidAt: Date }> {
    const payment = await this.lockPayment(tx, input.paymentId)
    if (!payment) throw new Error(`Payment ${input.paymentId} not found`)
    if (payment.state === 'PAID') return { applied: false, paidAt: payment.paidAt ?? input.performedAt }
    if (payment.state !== 'PENDING') throw AppError.conflict('payment_not_pending', `Payment is ${payment.state.toLowerCase()}`)

    await tx.payment.update({ where: { id: payment.id }, data: { state: 'PAID', paidAt: input.performedAt, provider: input.provider } })
    await this.subscriptions.applySettlement(tx, payment)
    if (input.sandbox) {
      // A test-key payment is no money: no revenue in the ledger, no receipt SMS (security review 10.11 №39).
      await this.audit.record({ tx, tenantId: payment.tenantId, action: 'payment.settled', entityType: 'Payment', entityId: payment.id, after: { provider: input.provider, providerTransactionId: input.providerTransactionId, amountMinor: payment.amountMinor.toString(), sandbox: true } })
      return { applied: true, paidAt: input.performedAt }
    }
    await this.ledger.post(tx, {
      tenantId: payment.tenantId,
      kind: 'PAYMENT_SETTLED',
      referenceType: 'Payment',
      referenceId: payment.id,
      description: `Subscription payment ${payment.id} via ${input.provider} (${input.providerTransactionId})`,
      entries: this.ledger.settlementEntries(input.provider, payment.amountMinor),
      createdById: input.actorId,
    })
    await this.outbox.enqueue(tx, { tenantId: payment.tenantId, type: 'payment.receipt', dedupeKey: `receipt:${payment.id}`, payload: { paymentId: payment.id } })
    await this.audit.record({ tx, tenantId: payment.tenantId, action: 'payment.settled', entityType: 'Payment', entityId: payment.id, after: { provider: input.provider, providerTransactionId: input.providerTransactionId, amountMinor: payment.amountMinor.toString() } })
    return { applied: true, paidAt: input.performedAt }
  }

  /** Cancel a pending payment (provider cancelled before capture, or the hold expired). Releases seat holds. */
  async cancelPending(tx: TransactionClient, paymentId: string, reason: string) {
    const payment = await this.lockPayment(tx, paymentId)
    if (!payment || payment.state !== 'PENDING') return false
    await tx.payment.update({ where: { id: payment.id }, data: { state: 'CANCELLED', cancelledAt: new Date() } })
    const sub = await tx.subscription.findFirst({ where: { id: payment.subscriptionId } })
    if (sub?.status === 'PENDING_PAYMENT') {
      await tx.enrollment.updateMany({ where: { subscriptionId: sub.id, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
      await tx.subscription.update({ where: { id: sub.id }, data: { status: 'DRAFT' } })
    }
    await this.audit.record({ tx, tenantId: payment.tenantId, action: 'payment.cancelled', entityType: 'Payment', entityId: payment.id, reason })
    return true
  }

  /** Refund after capture (provider-initiated reversal). Posts a reversal journal and releases the seats. */
  async refundPaid(tx: TransactionClient, paymentId: string, reason: string, actorId?: string) {
    const payment = await this.lockPayment(tx, paymentId)
    if (!payment) return false
    // Any of it already returned through a refund request — part or all (then the payment is REFUNDED): a cancellation by
    // the provider would return that money a second time. Refused in every state (security review 11.11, №77: a fully
    // refunded payment used to answer «cancelled», and Payme paid the card again); the rest goes back through a request.
    // A transaction the provider already cancelled never gets here: Payme's CancelTransaction answers it from its own row.
    if (payment.refundedMinor > 0n || payment.state === 'REFUNDED') return false
    if (payment.state !== 'PAID') return false
    const journal = await tx.ledgerJournal.findUnique({ where: { tenantId_kind_referenceType_referenceId: { tenantId: payment.tenantId, kind: 'PAYMENT_SETTLED', referenceType: 'Payment', referenceId: payment.id } } })
    if (journal) await this.ledger.reverse(tx, journal.id, 'PAYMENT_REFUNDED', reason, actorId)
    // The whole payment is returned (the database checks that REFUNDED means refundedMinor = amountMinor).
    await tx.payment.update({ where: { id: payment.id }, data: { state: 'REFUNDED', refundedAt: new Date(), refundedMinor: payment.amountMinor } })
    // A request waiting for this money is settled by it: returned in full through the provider.
    await tx.refundRequest.updateMany({
      where: { paymentId: payment.id, status: { in: ['PENDING', 'APPROVED'] } },
      data: { status: 'PAID', openKey: null, approvedMinor: payment.amountMinor, paidAt: new Date(), decidedAt: new Date(), providerRef: reason, decisionNote: 'Returned in full by the provider' },
    })
    const sub = await tx.subscription.findFirst({ where: { id: payment.subscriptionId } })
    const now = new Date()
    let lessonsTaken: number | null = null
    const cancelSub = async (subId: string) => {
      await tx.enrollment.updateMany({ where: { subscriptionId: subId, status: { in: ['PENDING', 'ACTIVE'] } }, data: { status: 'CANCELLED', cancelledAt: now } })
      await tx.subscription.update({ where: { id: subId }, data: { status: 'CANCELLED', cancelledAt: now } })
    }
    if (sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) {
      if (sub.kind === 'PERIOD' && payment.periodStart > now) {
        // A period paid ahead (security review №10): the subscription now ends where that period would have begun.
        if (sub.currentPeriodEnd && sub.currentPeriodEnd > payment.periodStart) await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: payment.periodStart } })
      } else if (sub.kind === 'PERIOD' && payment.periodEnd > now) {
        // The current period: its access goes. A period paid ahead starts now instead; without one the subscription ends.
        const next = await tx.payment.findFirst({ where: { subscriptionId: sub.id, state: 'PAID', id: { not: payment.id }, periodStart: { gte: payment.periodEnd } }, orderBy: { periodStart: 'asc' } })
        if (next) {
          // The paid period moves to now — in the payment too, so a later refund of it sees the period that runs.
          const end = new Date(now.getTime() + (next.periodEnd.getTime() - next.periodStart.getTime()))
          await tx.payment.update({ where: { id: next.id }, data: { periodStart: now, periodEnd: end } })
          await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: now, currentPeriodEnd: end } })
        } else await cancelSub(sub.id)
      } else if (sub.kind === 'LESSONS' && payment.lessonsBought != null) {
        // A lesson package (re-check 11.11 №78): the lessons of this payment still unused go, the rest of the balance — what
        // other payments bought — stays. The subscription ends only when no lesson is left.
        const taken = await this.unusedLessonsOf(tx, sub, payment)
        lessonsTaken = taken.lessons
        const left = Math.max(0, (sub.lessonsTotal ?? 0) - sub.lessonsUsed) - taken.lessons
        if (left <= 0 && (taken.lessons > 0 || taken.newest)) await cancelSub(sub.id)
        else if (taken.lessons > 0) await tx.subscription.update({ where: { id: sub.id }, data: { lessonsTotal: (sub.lessonsTotal ?? 0) - taken.lessons } })
      } else if (sub.kind !== 'PERIOD' && (!sub.currentPeriodEnd || payment.periodEnd >= sub.currentPeriodEnd)) {
        // A lesson payment from before Payment.lessonsBought: only the payment that bought the current balance takes the
        // subscription down.
        await cancelSub(sub.id)
      }
      // A period already over: nothing to take back.
    }
    await this.outbox.enqueue(tx, { tenantId: payment.tenantId, type: 'payment.refunded', dedupeKey: `refund:${payment.id}`, payload: { paymentId: payment.id, reason } })
    await this.audit.record({ tx, tenantId: payment.tenantId, action: 'payment.refunded', entityType: 'Payment', entityId: payment.id, reason, ...(lessonsTaken !== null ? { after: { lessonsTaken } } : {}) })
    return true
  }

  /**
   * How many of `payment`'s lessons are still in the subscription's balance. Lessons are used up oldest payment first —
   * a renewal adds its lessons to those left — so the balance is the newest payments' lessons, back to the oldest; the
   * refund request counts the same way. `newest`: this payment bought the latest lessons.
   */
  private async unusedLessonsOf(tx: TransactionClient, sub: { id: string; lessonsTotal: number | null; lessonsUsed: number }, payment: { id: string; paidAt: Date | null; createdAt: Date; lessonsBought: number | null }) {
    const others = await tx.payment.findMany({ where: { subscriptionId: sub.id, state: 'PAID', id: { not: payment.id }, lessonsBought: { not: null } }, select: { id: true, paidAt: true, createdAt: true, lessonsBought: true } })
    const at = (p: { paidAt: Date | null; createdAt: Date }) => (p.paidAt ?? p.createdAt).getTime()
    const newestFirst = [...others, payment].sort((a, b) => at(b) - at(a) || b.createdAt.getTime() - a.createdAt.getTime())
    let unused = Math.max(0, (sub.lessonsTotal ?? 0) - sub.lessonsUsed)
    for (const p of newestFirst) {
      const mine = Math.min(unused, p.lessonsBought ?? 0)
      if (p.id === payment.id) return { lessons: mine, newest: newestFirst[0].id === payment.id }
      unused -= mine
    }
    return { lessons: 0, newest: false }
  }

  /** Finance admin records an out-of-band payment (cash/bank transfer). Audited; uses the same settlement path. */
  async manualSettle(paymentId: string, actorId: string, reference: string) {
    return this.prisma.tx(async (tx) => {
      const payment = await this.lockPayment(tx, paymentId)
      if (!payment) throw AppError.notFound('Payment')
      // Already paid: nothing to record — a second manual transaction would show up in reconciliation as money that never
      // came (Н15). The answer is the same «not applied» a repeated provider callback gets.
      if (payment.state === 'PAID') return { applied: false, paidAt: payment.paidAt ?? new Date() }
      if (payment.state !== 'PENDING') throw AppError.conflict('payment_not_pending', `Payment is ${payment.state.toLowerCase()}`)
      const txRow = await tx.paymentTransaction.create({
        data: { tenantId: payment.tenantId, paymentId: payment.id, provider: 'MANUAL', providerTransactionId: `manual:${payment.id}:${Date.now()}`, state: 'PERFORMED', amountMinor: payment.amountMinor, currency: payment.currency, performedAt: new Date() },
      })
      const result = await this.settle(tx, { paymentId: payment.id, provider: 'MANUAL', providerTransactionId: txRow.providerTransactionId, performedAt: new Date(), actorId })
      await this.audit.record({ tx, tenantId: payment.tenantId, action: 'payment.manual_settle', entityType: 'Payment', entityId: payment.id, reason: reference, after: { applied: result.applied } })
      return result
    })
  }

  async statusForStudent(paymentId: string, studentId: string) {
    const payment = await this.prisma.client.payment.findFirst({ where: { id: paymentId, studentId }, include: { transactions: { orderBy: { createdAt: 'desc' }, take: 1 }, receipt: true } })
    if (!payment) throw AppError.notFound('Payment')
    return {
      id: payment.id, state: payment.state, provider: payment.provider, amountMinor: payment.amountMinor.toString(), currency: payment.currency,
      paidAt: payment.paidAt, expiresAt: payment.expiresAt, periodStart: payment.periodStart, periodEnd: payment.periodEnd, receiptNumber: payment.receipt?.number ?? null,
      lastTransactionState: payment.transactions[0]?.state ?? null,
    }
  }

  /** Called by the maintenance job for every tenant. */
  /** Old callback logs go: the provider's own after CALLBACK_LOG_DAYS, unproven ones after a week (security review №11). */
  async purgeCallbackLogs(now = new Date()): Promise<number> {
    const day = 86_400_000
    const res = await TenantContext.system(() => this.prisma.client.providerCallbackLog.deleteMany({
      where: { OR: [{ receivedAt: { lt: new Date(now.getTime() - CALLBACK_LOG_DAYS * day) } }, { tenantId: null, receivedAt: { lt: new Date(now.getTime() - UNPROVEN_CALLBACK_LOG_DAYS * day) } }] },
    }))
    return res.count
  }

  async expireAll(): Promise<number> {
    let total = 0
    const tenants = await TenantContext.system(() => this.prisma.client.tenant.findMany({ select: { id: true } }))
    for (const t of tenants) total += await TenantContext.forTenant(t.id, () => this.subscriptions.expirePending(t.id))
    if (total) this.logger.log(`Expired ${total} pending payments`)
    return total
  }
}
