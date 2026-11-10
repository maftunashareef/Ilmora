import { Injectable } from '@nestjs/common'
import type { PaymentProvider } from '../../generated/prisma/enums'
import { PrismaService } from '../../infra/prisma/prisma.service'

export interface ReconciliationFilter { provider?: PaymentProvider; from?: Date; to?: Date; status?: string; page?: number; pageSize?: number }

/**
 * Two layers, reported separately:
 *  1. internal consistency — provider callback state vs. payment state vs. ledger posting (always available);
 *  2. provider verification — none: Payme's Merchant API has no pull endpoint (GetStatement is Payme calling us), so
 *     rows are marked "provider check unavailable". (Click, the provider that had one, was removed on 10.11.)
 * Reconciliation never changes balances; discrepancies are surfaced for a human decision.
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
      this.prisma.client.paymentTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { payment: { select: { id: true, state: true, amountMinor: true, currency: true, paidAt: true, studentId: true } } } }),
      this.prisma.client.paymentTransaction.count({ where }),
    ])
    const paymentIds = rows.map((r) => r.paymentId)
    // A reversal journal carries "<paymentId>:reversal:<journalId>" as its own reference, so it is found through the
    // journal it reverses and filed under that payment; matching on referenceId alone made every refund look unposted.
    const journals = await this.prisma.client.ledgerJournal.findMany({
      where: { tenantId, referenceType: 'Payment', kind: { in: ['PAYMENT_SETTLED', 'PAYMENT_REFUNDED', 'REVERSAL'] }, OR: [{ referenceId: { in: paymentIds } }, { reversalOf: { referenceId: { in: paymentIds } } }] },
      select: { id: true, referenceId: true, kind: true, createdAt: true, reversalOf: { select: { referenceId: true } } },
    })
    const byPayment = new Map<string, typeof journals>()
    for (const j of journals) {
      const paymentId = j.reversalOf?.referenceId ?? j.referenceId
      byPayment.set(paymentId, [...(byPayment.get(paymentId) ?? []), j])
    }

    return {
      page,
      pageSize,
      total,
      items: rows.map((r) => {
        const js = byPayment.get(r.paymentId) ?? []
        const settled = js.some((j) => j.kind === 'PAYMENT_SETTLED')
        const refunded = js.some((j) => j.kind === 'PAYMENT_REFUNDED')
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
          currency: r.currency,
          createdAt: r.createdAt,
          performedAt: r.performedAt,
          cancelledAt: r.cancelledAt,
          ledger: { settled, refunded, journalIds: js.map((j) => j.id) },
          discrepancy: this.discrepancy(r, r.payment, settled, refunded),
          sandbox: r.sandbox,
        }
      }),
    }
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
   * Independent provider check for one transaction: not available — Payme has no status endpoint to ask. Kept so the
   * finance screen's «Check» button keeps working; it answers the same for every row.
   */
  async verifyWithProvider(tenantId: string, transactionId: string) {
    const row = await this.prisma.client.paymentTransaction.findFirst({ where: { tenantId, id: transactionId } })
    if (!row) return { available: false, reason: 'not_found' }
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
