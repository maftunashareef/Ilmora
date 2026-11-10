import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/config/env'
import type { PrismaService, TransactionClient } from '../src/infra/prisma/prisma.service'
import { PAYME, PaymeService, SANDBOX_ORDER_DAYS } from '../src/modules/payments/payme/payme.service'
import type { PaymentsService } from '../src/modules/payments/payments.service'
import { testEnv } from './helpers'

const LIVE = 'live-key-123456789012345678901234567'
const TEST = 'test-key-12345678901234567890123456'
const basic = (key: string) => `Basic ${Buffer.from(`Paycom:${key}`).toString('base64')}`

/** Production settings without the production-only checks of validateEnv (CORS, cookies, Redis), which are not under test here. */
const prodEnv = (sandboxIds: string[]): Env => ({ ...testEnv({ PAYME_LOGIN: 'Paycom', PAYME_KEY: LIVE, PAYME_TEST_KEY: TEST }), NODE_ENV: 'production', PAYME_SANDBOX_PAYMENT_IDS: sandboxIds })

function setup(env: Env, row: { paymentId: string; sandbox: boolean } | null = null, createdAt = new Date()) {
  const payment = (id: string) => ({ id, tenantId: 't', subscriptionId: 'sub-1', state: 'PENDING', amountMinor: 100n, currency: 'UZS', expiresAt: new Date(Date.now() + 3_600_000), createdAt })
  const txRow = row && { id: 'ptx-1', seq: 7, tenantId: 't', provider: 'PAYME', providerTransactionId: 'pm-1', providerTime: BigInt(Date.now()), providerState: 1, state: 'CREATED', amountMinor: 100n, currency: 'UZS', createdAt: new Date(), performedAt: null, cancelledAt: null, cancelReason: null, ...row }
  const findMany = vi.fn(async (_args: unknown) => [])
  const client = {
    payment: { findFirst: vi.fn(async (args: { where: { id: string } }) => payment(args.where.id)) },
    paymentTransaction: { findUnique: vi.fn(async () => txRow), findMany },
    subscription: { findFirst: vi.fn(async () => ({ package: { name: { ru: 'Duo', uz: 'Duo' } }, enrollments: [] })) },
  }
  const prisma = { client, tx: vi.fn(async (fn: (t: TransactionClient) => Promise<unknown>) => fn(client as unknown as TransactionClient)) }
  const payments = { settleBlocker: vi.fn(async () => null), lockPayment: vi.fn(async () => payment('x')) }
  return { payme: new PaymeService(prisma as unknown as PrismaService, payments as unknown as PaymentsService, env), findMany }
}

describe('Payme test key on production (PAYME_SANDBOX_PAYMENT_IDS)', () => {
  it('refuses the test key in production while no test orders are listed, and accepts it once they are', () => {
    expect(() => setup(prodEnv([])).payme.authenticate(basic(TEST))).toThrow(expect.objectContaining({ code: PAYME.UNAUTHORIZED }))
    expect(setup(prodEnv(['pay-test'])).payme.authenticate(basic(TEST))).toEqual({ sandbox: true })
    expect(setup(prodEnv(['pay-test'])).payme.authenticate(basic(LIVE))).toEqual({ sandbox: false })
  })

  it('closes a listed test order to the test key a week after it was created (security review 10.11 №39)', async () => {
    const old = new Date(Date.now() - (SANDBOX_ORDER_DAYS + 1) * 86_400_000)
    await expect(setup(prodEnv(['pay-test']), null, old).payme.handle('CheckPerformTransaction', { amount: 100, account: { payment_id: 'pay-test' } }, true)).rejects.toMatchObject({ code: PAYME.ACCOUNT_NOT_FOUND })
    // The live key is not affected, and the receipt line names the package with the unit code «услуга (раз)» (№41).
    const live = await setup(prodEnv(['pay-test']), null, old).payme.handle('CheckPerformTransaction', { amount: 100, account: { payment_id: 'pay-test' } }, false)
    expect(live).toMatchObject({ allow: true, detail: { items: [{ title: 'ILMORA — Duo', package_code: '1501338', price: 100, count: 1 }] } })
  })

  it('lets a test-key call reach only the listed test orders', async () => {
    const { payme } = setup(prodEnv(['pay-test']))
    await expect(payme.handle('CheckPerformTransaction', { amount: 100, account: { payment_id: 'pay-real' } }, true)).rejects.toMatchObject({ code: PAYME.ACCOUNT_NOT_FOUND })
    await expect(payme.handle('CreateTransaction', { id: 'pm-x', time: Date.now(), amount: 100, account: { payment_id: 'pay-real' } }, true)).rejects.toMatchObject({ code: PAYME.ACCOUNT_NOT_FOUND })
    expect(await payme.handle('CheckPerformTransaction', { amount: 100, account: { payment_id: 'pay-test' } }, true)).toMatchObject({ allow: true })
    // The live key is not limited by the list.
    expect(await payme.handle('CheckPerformTransaction', { amount: 100, account: { payment_id: 'pay-real' } }, false)).toMatchObject({ allow: true })
  })

  it.each(['PerformTransaction', 'CancelTransaction', 'CheckTransaction'])('hides a live transaction from a test-key %s', async (method) => {
    const { payme } = setup(prodEnv(['pay-test']), { paymentId: 'pay-real', sandbox: false })
    await expect(payme.handle(method, { id: 'pm-1', reason: 3 }, true)).rejects.toMatchObject({ code: PAYME.TX_NOT_FOUND })
  })

  it('shows a test-key GetStatement only sandbox transactions', async () => {
    const { payme, findMany } = setup(prodEnv(['pay-test']))
    await payme.handle('GetStatement', { from: 0, to: Date.now() }, true)
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { sandbox: true } })
    await payme.handle('GetStatement', { from: 0, to: Date.now() }, false)
    expect(findMany.mock.calls[1]?.[0]).not.toMatchObject({ where: { sandbox: true } })
  })
})
