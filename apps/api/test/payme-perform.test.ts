import { describe, expect, it, vi } from 'vitest'
import type { PrismaService, TransactionClient } from '../src/infra/prisma/prisma.service'
import { PAYME, PaymeError, PaymeService } from '../src/modules/payments/payme/payme.service'
import type { PaymentsService } from '../src/modules/payments/payments.service'
import { testEnv } from './helpers'

const env = testEnv({ PAYME_LOGIN: 'Paycom', PAYME_KEY: 'live-key-123456789012345678901234567' })
type Blocker = Awaited<ReturnType<PaymentsService['settleBlocker']>>

/** One Payme transaction row for one payment; the payments module is stubbed so the test sees exactly what the adapter asks of it. */
function setup(opts: { paymentState?: string; blocker?: Blocker; rowState?: 'CREATED' | 'PERFORMED'; rowExists?: boolean } = {}) {
  const calls: Record<string, unknown[]> = {}
  const spy = (name: string, result: unknown) => vi.fn(async (args: unknown) => { (calls[name] ??= []).push(args); return result })
  const performedAt = new Date('2026-11-06T10:00:00.000Z')
  const row = {
    id: 'ptx-1', seq: 7, tenantId: 't', paymentId: 'pay-1', provider: 'PAYME', providerTransactionId: 'pm-1', providerTime: BigInt(Date.now() - 60_000), providerState: 1,
    state: opts.rowState ?? 'CREATED', amountMinor: 100n, currency: 'UZS', createdAt: new Date(), performedAt: opts.rowState === 'PERFORMED' ? performedAt : null, cancelledAt: null,
  }
  const payment = { id: 'pay-1', tenantId: 't', subscriptionId: 'sub-1', state: opts.paymentState ?? 'PENDING', amountMinor: 100n, currency: 'UZS', expiresAt: new Date(Date.now() + 3_600_000) }
  const tx = {
    paymentTransaction: {
      findUnique: vi.fn(async () => (opts.rowExists === false ? null : row)),
      // By id: the locked re-read of the row; by payment: the "another active transaction" check (none here).
      findFirst: vi.fn(async (args: { where: { id?: string } }) => (args.where.id ? row : null)),
      update: spy('paymentTransaction.update', row),
      create: spy('paymentTransaction.create', { ...row, seq: 8 }),
    },
  }
  const prisma = { client: { payment: { findFirst: vi.fn(async () => payment) } }, tx: vi.fn(async (fn: (t: TransactionClient) => Promise<unknown>) => fn(tx as unknown as TransactionClient)) }
  const payments = {
    lockPayment: vi.fn(async () => payment),
    settleBlocker: vi.fn(async () => opts.blocker ?? null),
    settle: vi.fn(async (_tx: unknown, _input: unknown) => ({ applied: true, paidAt: new Date() })),
    cancelPending: vi.fn(async () => true),
  }
  const payme = new PaymeService(prisma as unknown as PrismaService, payments as unknown as PaymentsService, env)
  return { payme, prisma, payments, calls, performedAt }
}

describe('Payme PerformTransaction on an order that can no longer be fulfilled', () => {
  const params = { id: 'pm-1' }

  it.each([
    ['the hold was cancelled or expired', { paymentState: 'CANCELLED', blocker: 'payment_not_pending' as const }],
    ['the invoice was paid through the other provider', { paymentState: 'PAID', blocker: 'payment_not_pending' as const }],
    ['the subscription was closed meanwhile', { paymentState: 'PENDING', blocker: 'subscription_closed' as const }],
  ])('refuses with -31008 instead of settling when %s, and closes the transaction row', async (_label, opts) => {
    const { payme, prisma, payments, calls } = setup(opts)
    await expect(payme.handle('PerformTransaction', params, false)).rejects.toMatchObject({ code: PAYME.CANNOT_PERFORM })
    expect(payments.settle).not.toHaveBeenCalled()
    expect(calls['paymentTransaction.update']?.[0]).toMatchObject({ where: { id: 'ptx-1' }, data: { state: 'CANCELLED', providerState: -1, cancelReason: 3 } })
    expect(payments.cancelPending).toHaveBeenCalledTimes(1)
    // The refusal is raised after the transaction committed, so the cancelled row is not rolled back together with it.
    await expect(prisma.tx.mock.results[0]!.value).resolves.toBeInstanceOf(PaymeError)
  })

  it('settles a pending order exactly once and answers repeats with the stored perform time', async () => {
    const { payme, payments } = setup()
    expect(await payme.handle('PerformTransaction', params, false)).toMatchObject({ state: 2, transaction: '7' })
    expect(payments.settle).toHaveBeenCalledTimes(1)
    expect(payments.settle.mock.calls[0]?.[1]).toMatchObject({ paymentId: 'pay-1', provider: 'PAYME', providerTransactionId: 'pm-1' })

    const repeat = setup({ rowState: 'PERFORMED' })
    expect(await repeat.payme.handle('PerformTransaction', params, false)).toEqual({ transaction: '7', perform_time: repeat.performedAt.getTime(), state: 2 })
    expect(repeat.payments.settle).not.toHaveBeenCalled()
  })

  it('CheckPerformTransaction and CreateTransaction refuse an order that is not payable without creating a transaction', async () => {
    const account = { payment_id: 'pay-1' }
    const create = { id: 'pm-new', time: Date.now(), amount: 100, account }
    const paid = setup({ paymentState: 'PAID', blocker: 'payment_not_pending', rowExists: false })
    await expect(paid.payme.handle('CheckPerformTransaction', { amount: 100, account }, false)).rejects.toMatchObject({ code: PAYME.ORDER_NOT_PENDING })
    await expect(paid.payme.handle('CreateTransaction', create, false)).rejects.toMatchObject({ code: PAYME.ORDER_NOT_PENDING })
    expect(paid.calls['paymentTransaction.create']).toBeUndefined()

    const closed = setup({ blocker: 'subscription_closed', rowExists: false })
    await expect(closed.payme.handle('CreateTransaction', create, false)).rejects.toMatchObject({ code: PAYME.ORDER_NOT_PENDING })
    expect(closed.calls['paymentTransaction.create']).toBeUndefined()

    const open = setup({ rowExists: false })
    expect(await open.payme.handle('CreateTransaction', create, false)).toMatchObject({ state: 1, transaction: '8' })
  })
})
