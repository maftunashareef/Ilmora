import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService, TransactionClient } from '../src/infra/prisma/prisma.service'
import type { AuditService } from '../src/modules/audit/audit.service'
import type { SubscriptionService } from '../src/modules/enrollment/subscription.service'
import { ClickService } from '../src/modules/payments/click/click.service'
import { LedgerService } from '../src/modules/payments/ledger.service'
import type { OutboxService } from '../src/modules/payments/outbox.service'
import { PaymentsService } from '../src/modules/payments/payments.service'
import { ReconciliationService } from '../src/modules/payments/reconciliation.service'
import { testEnv } from './helpers'

const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const txOf = (stub: object) => vi.fn(async (fn: (t: TransactionClient) => Promise<unknown>) => fn(stub as unknown as TransactionClient))

describe('Click callbacks for an invoice that can no longer be fulfilled', () => {
  const env = testEnv({ CLICK_SERVICE_ID: '77', CLICK_MERCHANT_ID: '1', CLICK_SECRET_KEY: 'click-secret' })
  const signTime = '2026-11-06 12:00:00'

  function setup(paymentState: 'PENDING' | 'PAID' | 'CANCELLED', blocker: 'payment_not_pending' | 'subscription_closed' | null) {
    const row = { id: 'ptx-1', seq: 7, tenantId: 't', paymentId: 'pay-1', provider: 'CLICK', providerTransactionId: '555', state: 'CREATED', amountMinor: 100n, currency: 'UZS' }
    const payment = { id: 'pay-1', tenantId: 't', subscriptionId: 'sub-1', state: paymentState, amountMinor: 100n, currency: 'UZS', expiresAt: new Date(Date.now() + 3_600_000) }
    const tx = {
      paymentTransaction: { findUnique: vi.fn(async () => row), findFirst: vi.fn(async () => row), update: vi.fn(async () => row), create: vi.fn() },
      payment: { findFirst: vi.fn(async () => payment) },
      outboxEvent: { upsert: vi.fn(async () => ({})) },
    }
    const payments = { lockPayment: vi.fn(async () => payment), settleBlocker: vi.fn(async () => blocker), settle: vi.fn(async () => ({ applied: true, paidAt: new Date() })), cancelPending: vi.fn(async () => true) }
    const click = new ClickService({ tx: txOf(tx) } as unknown as PrismaService, payments as unknown as PaymentsService, env)
    const base = { click_trans_id: '555', service_id: '77', merchant_trans_id: 'pay-1', amount: '1.00', sign_time: signTime }
    const complete = { ...base, action: '1', merchant_prepare_id: '7', error: '0', sign_string: md5(`555${'77'}click-secret${'pay-1'}${'7'}1.00${'1'}${signTime}`) }
    const prepare = { ...base, action: '0', sign_string: md5(`555${'77'}click-secret${'pay-1'}1.00${'0'}${signTime}`) }
    return { click, tx, payments, complete, prepare }
  }

  it('complete does not settle an invoice paid through the other provider: success per Click rules plus a refund for finance', async () => {
    const { click, tx, payments, complete } = setup('PAID', 'payment_not_pending')
    expect(await click.complete(complete)).toMatchObject({ error: 0, merchant_confirm_id: 7 })
    expect(payments.settle).not.toHaveBeenCalled()
    expect(tx.outboxEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ type: 'payment.refund_required', payload: expect.objectContaining({ paymentId: 'pay-1', reason: 'payment_not_pending', paymentState: 'PAID' }) }),
    }))
  })

  it('complete settles a pending invoice once', async () => {
    const { click, tx, payments, complete } = setup('PENDING', null)
    expect(await click.complete(complete)).toMatchObject({ error: 0, merchant_confirm_id: 7 })
    expect(payments.settle).toHaveBeenCalledTimes(1)
    expect(tx.outboxEvent.upsert).not.toHaveBeenCalled()
  })

  it('prepare refuses an invoice that is already paid, and one whose subscription is closed', async () => {
    const paid = setup('PAID', 'payment_not_pending')
    expect((await paid.click.prepare(paid.prepare)).error).toBe(-4)
    const closed = setup('PENDING', 'subscription_closed')
    expect((await closed.click.prepare(closed.prepare)).error).toBe(-9)
    expect(paid.tx.paymentTransaction.create).not.toHaveBeenCalled()
    expect(closed.tx.paymentTransaction.create).not.toHaveBeenCalled()
  })
})

describe('reconciliation files reversal journals under the payment they reverse', () => {
  function setup(journals: { id: string; referenceId: string; kind: string; reversalOf: { referenceId: string } | null }[]) {
    const row = {
      id: 'ptx-1', seq: 7, provider: 'PAYME', providerTransactionId: 'pm-1', providerState: -2, state: 'CANCELLED', paymentId: 'pay-1', amountMinor: 100n, currency: 'UZS',
      createdAt: new Date(), performedAt: new Date(), cancelledAt: new Date(), sandbox: false, payment: { id: 'pay-1', state: 'REFUNDED', amountMinor: 100n, currency: 'UZS', paidAt: new Date(), studentId: 's1' },
    }
    const ledgerJournal = { findMany: vi.fn(async (_args: unknown) => journals.map((j) => ({ ...j, createdAt: new Date() }))) }
    const prisma = { client: { paymentTransaction: { findMany: vi.fn(async () => [row]), count: vi.fn(async () => 1) }, ledgerJournal } }
    return { service: new ReconciliationService(prisma as unknown as PrismaService, {} as ClickService), ledgerJournal }
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
        findFirst: vi.fn(async () => ({ id: 'pay-x', tenantId: 't', subscriptionId: 'sub-1', state: 'PAID', amountMinor: 100n, periodStart: new Date(refunded.periodEnd.getTime() - 30 * 86_400_000), periodEnd: refunded.periodEnd })),
        update: vi.fn(async () => ({})),
      },
      ledgerJournal: { findUnique: vi.fn(async () => null) },
      subscription: { findFirst: vi.fn(async () => ({ id: 'sub-1', ...sub })), update: vi.fn(async () => ({})) },
      enrollment: { updateMany: vi.fn(async () => ({ count: 1 })) },
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
