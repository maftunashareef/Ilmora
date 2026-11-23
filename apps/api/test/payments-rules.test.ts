import { describe, expect, it, vi } from 'vitest'
import type { PrismaService, TransactionClient } from '../src/infra/prisma/prisma.service'
import type { AuditService } from '../src/modules/audit/audit.service'
import type { SubscriptionService } from '../src/modules/enrollment/subscription.service'
import { LedgerService } from '../src/modules/payments/ledger.service'
import type { OutboxService } from '../src/modules/payments/outbox.service'
import { PaymentsService } from '../src/modules/payments/payments.service'
import { ReconciliationService } from '../src/modules/payments/reconciliation.service'
import { testEnv } from './helpers'


describe('reconciliation files reversal journals under the payment they reverse', () => {
  function setup(journals: { id: string; referenceId: string; kind: string; reversalOf: { referenceId: string } | null }[]) {
    const row = {
      id: 'ptx-1', seq: 7, provider: 'PAYME', providerTransactionId: 'pm-1', providerState: -2, state: 'CANCELLED', paymentId: 'pay-1', amountMinor: 100n, currency: 'UZS',
      createdAt: new Date(), performedAt: new Date(), cancelledAt: new Date(), sandbox: false, payment: { id: 'pay-1', state: 'REFUNDED', amountMinor: 100n, refundedMinor: 100n, currency: 'UZS', paidAt: new Date(), studentId: 's1' },
    }
    // A refund journal debits the revenue it gives back; the settlement's entries do not count as refunded.
    const ledgerJournal = { findMany: vi.fn(async (_args: unknown) => journals.map((j) => ({ ...j, createdAt: new Date(), entries: [{ direction: 'DEBIT', amountMinor: 100n }, { direction: 'CREDIT', amountMinor: 100n }] }))) }
    const prisma = { client: { paymentTransaction: { findMany: vi.fn(async () => [row]), count: vi.fn(async () => 1), groupBy: vi.fn(async () => []) }, ledgerJournal, refundRequest: { findMany: vi.fn(async () => []) } } }
    return { service: new ReconciliationService(prisma as unknown as PrismaService), ledgerJournal }
  }

  it('a refunded Payme payment whose reversal is posted reconciles clean', async () => {
    const { service, ledgerJournal } = setup([
      { id: 'j1', referenceId: 'pay-1', kind: 'PAYMENT_SETTLED', reversalOf: null },
      { id: 'j2', referenceId: 'pay-1:reversal:j1', kind: 'PAYMENT_REFUNDED', reversalOf: { referenceId: 'pay-1' } },
    ])
    const { items } = await service.list('t', {})
    expect(items[0]).toMatchObject({ discrepancy: null, ledger: { settled: true, refunded: true, journalIds: ['j1', 'j2'] } })
    expect(ledgerJournal.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { OR: [{ referenceId: { in: ['pay-1'] } }, { reversalOf: { referenceId: { in: ['pay-1'] } } }] } })
  })

  it('a refund whose reversal was never posted is still reported', async () => {
    const { service } = setup([{ id: 'j1', referenceId: 'pay-1', kind: 'PAYMENT_SETTLED', reversalOf: null }])
    const { items } = await service.list('t', {})
    expect(items[0]?.discrepancy).toBe('refund_ledger_missing')
  })
})

describe('a provider refund takes the subscription down only for the period it paid for', () => {
  const env = testEnv()
  const audit = { record: async () => undefined } as unknown as AuditService

  function setup(refunded: { periodEnd: Date }, sub: { status: string; currentPeriodEnd: Date | null }) {
    const tx = {
      $queryRawUnsafe: vi.fn(async () => []),
      payment: {
        findFirst: vi.fn(async () => ({ id: 'pay-x', tenantId: 't', subscriptionId: 'sub-1', state: 'PAID', amountMinor: 100n, refundedMinor: 0n, periodStart: new Date(refunded.periodEnd.getTime() - 30 * 86_400_000), periodEnd: refunded.periodEnd })),
        update: vi.fn(async () => ({})),
      },
      ledgerJournal: { findUnique: vi.fn(async () => null) },
      subscription: { findFirst: vi.fn(async () => ({ id: 'sub-1', ...sub })), update: vi.fn(async () => ({})) },
      enrollment: { updateMany: vi.fn(async () => ({ count: 1 })) },
      refundRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
    }
    const payments = new PaymentsService({} as PrismaService, new LedgerService(), { enqueue: async () => undefined } as unknown as OutboxService, {} as SubscriptionService, audit, env)
    return { payments, tx }
  }

  it('leaves a subscription alone whose newer period is paid', async () => {
    const { payments, tx } = setup({ periodEnd: new Date('2026-03-01T00:00:00.000Z') }, { status: 'ACTIVE', currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z') })
    expect(await payments.refundPaid(tx as unknown as TransactionClient, 'pay-x', 'payme-cancel:5')).toBe(true)
    expect(tx.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'REFUNDED', refundedMinor: 100n }) }))
    expect(tx.subscription.update).not.toHaveBeenCalled()
    expect(tx.enrollment.updateMany).not.toHaveBeenCalled()
  })

  it('cancels it when the refunded payment bought the current period', async () => {
    const end = new Date('2026-04-01T00:00:00.000Z')
    const { payments, tx } = setup({ periodEnd: end }, { status: 'ACTIVE', currentPeriodEnd: end })
    expect(await payments.refundPaid(tx as unknown as TransactionClient, 'pay-x', 'payme-cancel:5')).toBe(true)
    expect(tx.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }))
    expect(tx.enrollment.updateMany).toHaveBeenCalledTimes(1)
  })
})
