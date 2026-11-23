import { Injectable } from '@nestjs/common'
import type { PaymentProvider } from '../../generated/prisma/enums'
import { PrismaService } from '../../infra/prisma/prisma.service'

export interface ReconciliationFilter { provider?: PaymentProvider; from?: Date; to?: Date; status?: string; page?: number; pageSize?: number }

/**
 * Two layers, reported separately:
 *  1. internal consistency — provider callback state vs. payment state vs. ledger posting (always available);
 *  2. provider verification — none: Payme's Merchant API has no pull endpoint (GetStatement is Payme calling us), and
 *     Click's status call is not connected (no Merchant API user), so rows are marked "provider check unavailable" and
 *     are reconciled against the statements in the providers' cabinets.
 * Reconciliation never changes balances; discrepancies are surfaced for a human decision. Money taken that bought nothing
 * — a second performed transaction on one invoice, or one on an invoice that expired or was cancelled — is
 * `double_payment` / `refund_required` (security review 10.11 №6: it used to read «no discrepancy»).
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, f: ReconciliationFilter) {
    const page = Math.max(1, f.page ?? 1)
    const pageSize = Math.min(200, Math.max(10, f.pageSize ?? 50))
    const where = {
      tenantId,
      ...(f.provider ? { provider: f.provider } : {}),
      ...(f.status ? { state: f.status as 'CREATED' | 'PERFORMED' | 'CANCELLED' | 'FAILED' } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.paymentTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { payment: { select: { id: true, state: true, amountMinor: true, refundedMinor: true, currency: true, paidAt: true, studentId: true } } } }),
      this.prisma.client.paymentTransaction.count({ where }),
    ])
    const paymentIds = rows.map((r) => r.paymentId)
    // Performed transactions per invoice, over all pages: more than one means the student paid twice.
    const performed = await this.prisma.client.paymentTransaction.groupBy({ by: ['paymentId'], where: { tenantId, paymentId: { in: paymentIds }, state: 'PERFORMED', sandbox: false }, _count: { _all: true } })
    const performedCount = new Map(performed.map((p) => [p.paymentId, p._count._all]))
    // A reversal journal carries "<paymentId>:reversal:<journalId>" as its own reference, so it is found through the
    // journal it reverses and filed under that payment; matching on referenceId alone made every refund look unposted.
    const journals = await this.prisma.client.ledgerJournal.findMany({
      where: { tenantId, referenceType: 'Payment', kind: { in: ['PAYMENT_SETTLED', 'PAYMENT_REFUNDED', 'REVERSAL'] }, OR: [{ referenceId: { in: paymentIds } }, { reversalOf: { referenceId: { in: paymentIds } } }] },
      select: { id: true, referenceId: true, kind: true, createdAt: true, reversalOf: { select: { referenceId: true } }, entries: { select: { direction: true, amountMinor: true } } },
    })
    const byPayment = new Map<string, { id: string; kind: string; refundMinor: bigint }[]>()
    const file = (paymentId: string, j: { id: string; kind: string; refundMinor: bigint }) => byPayment.set(paymentId, [...(byPayment.get(paymentId) ?? []), j])
    const debit = (entries: { direction: string; amountMinor: bigint }[]) => entries.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + e.amountMinor, 0n)
    for (const j of journals) file(j.reversalOf?.referenceId ?? j.referenceId, { id: j.id, kind: j.kind, refundMinor: j.kind === 'PAYMENT_SETTLED' ? 0n : debit(j.entries) })
    // Partial refunds are posted under their refund request (security review 10.11 №42): filed under its payment.
    const requests = await this.prisma.client.refundRequest.findMany({ where: { tenantId, paymentId: { in: paymentIds }, status: 'PAID' }, select: { id: true, paymentId: true } })
    if (requests.length) {
      const paymentOf = new Map(requests.map((r) => [r.id, r.paymentId]))
      const refundJournals = await this.prisma.client.ledgerJournal.findMany({ where: { tenantId, referenceType: 'RefundRequest', kind: 'PAYMENT_REFUNDED', referenceId: { in: [...paymentOf.keys()] } }, select: { id: true, kind: true, referenceId: true, entries: { select: { direction: true, amountMinor: true } } } })
      for (const j of refundJournals) file(paymentOf.get(j.referenceId)!, { id: j.id, kind: j.kind, refundMinor: debit(j.entries) })
    }

    return {
      page,
      pageSize,
      total,
      items: rows.map((r) => {
        const js = byPayment.get(r.paymentId) ?? []
        const settled = js.some((j) => j.kind === 'PAYMENT_SETTLED')
        const refunded = js.some((j) => j.kind === 'PAYMENT_REFUNDED')
        const refundedLedgerMinor = js.reduce((sum, j) => sum + j.refundMinor, 0n)
        return {
          transactionId: r.id,
          seq: r.seq,
          provider: r.provider,
          providerTransactionId: r.providerTransactionId,
          providerState: r.providerState,
          transactionState: r.state,
          paymentId: r.paymentId,
          paymentState: r.payment.state,
          amountMinor: r.amountMinor.toString(),
          paymentAmountMinor: r.payment.amountMinor.toString(),
          paymentRefundedMinor: r.payment.refundedMinor.toString(),
          currency: r.currency,
          createdAt: r.createdAt,
          performedAt: r.performedAt,
          cancelledAt: r.cancelledAt,
          ledger: { settled, refunded, journalIds: js.map((j) => j.id) },
          discrepancy: this.moneyWithoutOrder(r, r.payment, performedCount.get(r.paymentId) ?? 0) ?? this.discrepancy(r, r.payment, settled, refunded) ?? (!r.sandbox && r.payment.refundedMinor !== refundedLedgerMinor ? 'refund_amount_mismatch' : null),
          // Money returned by our own transfer while the provider still shows the payment as performed (№77): a cancellation
          // in the provider's cabinet would pay the card again, so the API refuses it — the finance admin sees why here.
          refundedOutsideProvider: r.state === 'PERFORMED' && r.payment.refundedMinor > 0n,
          sandbox: r.sandbox,
        }
      }),
    }
  }

  /**
   * Money the provider took that bought nothing (security review 10.11 №6): to be returned to the student.
   * - `refund_required` — performed on an invoice that expired or was cancelled meanwhile;
   * - `double_payment` — one of two (or more) performed transactions on one invoice;
   * - `check_with_provider` — Click reported a payment complete for an attempt closed here: answered «cancelled», so Click
   *   should have returned the money; make sure in the Click cabinet.
   */
  private moneyWithoutOrder(tx: { provider: string; state: string; providerState: number | null; sandbox: boolean }, payment: { state: string }, performedOnInvoice: number): string | null {
    if (tx.sandbox) return null
    if (tx.state === 'PERFORMED' && (payment.state === 'EXPIRED' || payment.state === 'CANCELLED')) return 'refund_required'
    if (tx.state === 'PERFORMED' && performedOnInvoice > 1) return 'double_payment'
    if (tx.provider === 'CLICK' && tx.state === 'CANCELLED' && tx.providerState === 1) return 'check_with_provider'
    return null
  }

  private discrepancy(tx: { state: string; amountMinor: bigint }, payment: { state: string; amountMinor: bigint }, settled: boolean, refunded: boolean): string | null {
    if (tx.amountMinor !== payment.amountMinor) return 'amount_mismatch'
    if (tx.state === 'PERFORMED' && payment.state === 'PAID' && !settled) return 'ledger_missing'
    if (tx.state === 'PERFORMED' && payment.state === 'PENDING') return 'payment_not_marked_paid'
    if (tx.state !== 'PERFORMED' && payment.state === 'PAID' && settled) return null // another transaction settled it
    if (payment.state === 'REFUNDED' && !refunded) return 'refund_ledger_missing'
    if (tx.state === 'CANCELLED' && payment.state === 'PAID') return 'cancelled_after_paid'
    if (settled && payment.state !== 'PAID' && payment.state !== 'REFUNDED') return 'ledger_without_payment'
    return null
  }

  /**
   * Independent provider check for one transaction: not available — Payme has no status endpoint to ask, and Click's
   * (Merchant API) is not connected. It answers the same for every row; reconcile against the cabinet statements.
   */
  async verifyWithProvider(tenantId: string, transactionId: string) {
    const row = await this.prisma.client.paymentTransaction.findFirst({ where: { tenantId, id: transactionId } })
    if (!row) return { available: false, reason: 'not_found' }
    if (row.provider === 'CLICK') return { available: false, reason: 'provider_check_unavailable', note: 'Click Merchant API is not connected; reconcile against the statement in the Click cabinet (merchant.click.uz).' }
    return { available: false, reason: 'provider_check_unavailable', note: 'Payme Merchant API has no status pull endpoint; reconcile against the cabinet statement (GetStatement is served by this API).' }
  }

  /** Simple balances per ledger account for the finance dashboard header. */
  async balances(tenantId: string) {
    const rows = await this.prisma.client.ledgerEntry.groupBy({ by: ['account', 'accountType', 'direction'], where: { tenantId }, _sum: { amountMinor: true } })
    const acc = new Map<string, { account: string; accountType: string; debit: bigint; credit: bigint }>()
    for (const r of rows) {
      const cur = acc.get(r.account) ?? { account: r.account, accountType: r.accountType, debit: 0n, credit: 0n }
      if (r.direction === 'DEBIT') cur.debit += r._sum.amountMinor ?? 0n
      else cur.credit += r._sum.amountMinor ?? 0n
      acc.set(r.account, cur)
    }
    return [...acc.values()].map((a) => ({ ...a, debit: a.debit.toString(), credit: a.credit.toString(), net: (a.debit - a.credit).toString() }))
  }
}
