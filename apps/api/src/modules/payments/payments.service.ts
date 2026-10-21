import { Inject, Injectable, Logger } from '@nestjs/common'
import { tiyinToClickAmount } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { ENV, type Env, clickConfigured, paymeConfigured } from '../../config/env'
import type { PaymentProvider } from '../../generated/prisma/enums'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { SubscriptionService } from '../enrollment/subscription.service'
import { LedgerService } from './ledger.service'
import { OutboxService } from './outbox.service'

export interface SettleInput {
  paymentId: string
  provider: PaymentProvider
  providerTransactionId: string
  performedAt: Date
  actorId?: string
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
    return { PAYME: paymeConfigured(this.env), CLICK: clickConfigured(this.env) }
  }

  /** Builds the hosted-checkout URL for a pending payment (no card data ever touches ILMORA). */
  checkoutLink(payment: { id: string; amountMinor: bigint; provider: PaymentProvider | null; expiresAt: Date }, provider: 'PAYME' | 'CLICK', lang: 'uz' | 'ru' | 'en') {
    const returnUrl = `${this.env.PUBLIC_WEB_URL}/${lang}/payments/${payment.id}/return`
    if (provider === 'PAYME') {
      if (!paymeConfigured(this.env)) throw AppError.unavailable('Payme is not configured yet')
      const params = `m=${this.env.PAYME_MERCHANT_ID};ac.payment_id=${payment.id};a=${payment.amountMinor.toString()};l=${lang};c=${returnUrl}`
      const url = `${this.env.PAYME_CHECKOUT_URL.replace(/\/$/, '')}/${Buffer.from(params, 'utf8').toString('base64')}`
      return { paymentId: payment.id, provider, url, expiresAt: payment.expiresAt }
    }
    if (!clickConfigured(this.env)) throw AppError.unavailable('Click is not configured yet')
    const q = new URLSearchParams({
      service_id: this.env.CLICK_SERVICE_ID!,
      merchant_id: this.env.CLICK_MERCHANT_ID!,
      amount: tiyinToClickAmount(payment.amountMinor),
      transaction_param: payment.id,
      return_url: returnUrl,
    })
    return { paymentId: payment.id, provider, url: `${this.env.CLICK_PAY_URL.replace(/\/$/, '')}/?${q.toString()}`, expiresAt: payment.expiresAt }
  }

  async lockPayment(tx: TransactionClient, paymentId: string) {
    await tx.$queryRawUnsafe(`SELECT id FROM "Payment" WHERE id = $1 FOR UPDATE`, paymentId)
    return tx.payment.findFirst({ where: { id: paymentId } })
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
    if (payment.state === 'REFUNDED') return true
    if (payment.state !== 'PAID') return false
    const journal = await tx.ledgerJournal.findUnique({ where: { tenantId_kind_referenceType_referenceId: { tenantId: payment.tenantId, kind: 'PAYMENT_SETTLED', referenceType: 'Payment', referenceId: payment.id } } })
    if (journal) await this.ledger.reverse(tx, journal.id, 'PAYMENT_REFUNDED', reason, actorId)
    await tx.payment.update({ where: { id: payment.id }, data: { state: 'REFUNDED', refundedAt: new Date() } })
    const sub = await tx.subscription.findFirst({ where: { id: payment.subscriptionId } })
    if (sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) {
      await tx.enrollment.updateMany({ where: { subscriptionId: sub.id, status: { in: ['PENDING', 'ACTIVE'] } }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
      await tx.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
    }
    await this.outbox.enqueue(tx, { tenantId: payment.tenantId, type: 'payment.refunded', dedupeKey: `refund:${payment.id}`, payload: { paymentId: payment.id, reason } })
    await this.audit.record({ tx, tenantId: payment.tenantId, action: 'payment.refunded', entityType: 'Payment', entityId: payment.id, reason })
    return true
  }

  /** Finance admin records an out-of-band payment (cash/bank transfer). Audited; uses the same settlement path. */
  async manualSettle(paymentId: string, actorId: string, reference: string) {
    return this.prisma.tx(async (tx) => {
      const payment = await this.lockPayment(tx, paymentId)
      if (!payment) throw AppError.notFound('Payment')
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
  async expireAll(): Promise<number> {
    let total = 0
    const tenants = await TenantContext.system(() => this.prisma.client.tenant.findMany({ select: { id: true } }))
    for (const t of tenants) total += await TenantContext.forTenant(t.id, () => this.subscriptions.expirePending(t.id))
    if (total) this.logger.log(`Expired ${total} pending payments`)
    return total
  }
}
