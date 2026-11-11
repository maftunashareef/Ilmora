import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configureBodyParsing } from '../src/body-parsing'
import { ENV, type Env } from '../src/config/env'
import { PrismaService } from '../src/infra/prisma/prisma.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { PaymeController } from '../src/modules/payments/payme/payme.controller'
import { PAYME, PaymeService } from '../src/modules/payments/payme/payme.service'
import { DB_AVAILABLE, TestContext } from './helpers'

const LIVE = 'live-key-123456789012345678901234567'
const TEST = 'test-key-12345678901234567890123456'
const basic = (key: string) => `Basic ${Buffer.from(`Paycom:${key}`).toString('base64')}`

type Rpc = { result?: Record<string, unknown>; error?: { code: number; message: Record<string, string>; data?: unknown }; id: unknown }

/**
 * Payme's sandbox checklist (docs/payments/payme-merchant-api.md §9), replayed over HTTP against the real controller,
 * body parsing and database. Production settings with PAYME_SANDBOX_PAYMENT_IDS, as on ilmoraa.uz during the tests
 * (docs/payments/onboarding-checklist.md, Payme step 4): two test orders, scenario 1 on the first, scenario 2 on the second.
 */
describe.skipIf(!DB_AVAILABLE)('Payme sandbox checklist over HTTP', () => {
  const ctx = new TestContext()
  let app: NestExpressApplication
  let tenantId: string
  let order1: { id: string; amount: number; subscriptionId: string }
  let order2: { id: string; amount: number; subscriptionId: string }
  let rpcId = 1000
  const tx1 = `sbx1${Date.now().toString(16)}`.padEnd(24, '0').slice(0, 24)
  const tx2 = `sbx2${Date.now().toString(16)}`.padEnd(24, '0').slice(0, 24)
  const startedAt = Date.now()

  const call = (method: string, params: object, key = TEST) => {
    const id = ++rpcId
    return request(app.getHttpServer())
      .post('/payments/payme')
      .set('Content-Type', 'text/json; charset=UTF-8')
      .set('Authorization', basic(key))
      .send(JSON.stringify({ method, params, id }))
      .then((res) => {
        // Every answer, error or not, is HTTP 200 and echoes the request id.
        expect(res.status).toBe(200)
        expect(res.body.id).toBe(id)
        return res.body as Rpc
      })
  }
  const db = <T>(fn: () => Promise<T>) => TenantContext.system(fn, { tenantId })

  beforeAll(async () => {
    await ctx.connect()
    const t = await ctx.makeTenant('pms')
    tenantId = t.tenantId
    const [s1, s2] = await Promise.all([ctx.makeStudent(tenantId, 81_001), ctx.makeStudent(tenantId, 81_002)])
    const c1 = await ctx.checkout(tenantId, s1.id, t.pkg.id, [t.group.id, t.group2.id])
    const c2 = await ctx.checkout(tenantId, s2.id, t.pkg.id, [t.group.id, t.group2.id])
    order1 = { id: c1.payment.id, amount: Number(c1.payment.amountMinor), subscriptionId: c1.payment.subscriptionId }
    order2 = { id: c2.payment.id, amount: Number(c2.payment.amountMinor), subscriptionId: c2.payment.subscriptionId }

    const env: Env = { ...ctx.env, NODE_ENV: 'production', PAYME_LOGIN: 'Paycom', PAYME_MERCHANT_ID: 'merchant-test', PAYME_KEY: LIVE, PAYME_TEST_KEY: TEST, PAYME_SANDBOX_PAYMENT_IDS: [order1.id, order2.id] }
    const payme = new PaymeService(ctx.prisma, ctx.payments, env)
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymeController],
      providers: [
        { provide: PaymeService, useValue: payme },
        { provide: PrismaService, useValue: ctx.prisma },
        { provide: ENV, useValue: env },
      ],
    }).compile()
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false })
    configureBodyParsing(app)
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
    await ctx.close()
  })

  it('transport: wrong credentials -32504, not POST -32300, broken JSON -32700, unknown method -32601 — all over HTTP 200', async () => {
    const wrong = await call('CheckPerformTransaction', { amount: order1.amount, account: { payment_id: order1.id } }, 'not-the-key')
    expect(wrong.error).toMatchObject({ code: PAYME.UNAUTHORIZED, message: { ru: expect.any(String), uz: expect.any(String), en: expect.any(String) } })
    expect(wrong.result).toBeUndefined()

    const get = await request(app.getHttpServer()).get('/payments/payme').set('Authorization', basic(TEST))
    expect(get.status).toBe(200)
    expect(get.body.error.code).toBe(PAYME.NOT_POST)

    const broken = await request(app.getHttpServer()).post('/payments/payme').set('Content-Type', 'text/json; charset=UTF-8').set('Authorization', basic(TEST)).send('{"method": "CheckPerformTransaction", ')
    expect(broken.status).toBe(200)
    expect(broken.body).toMatchObject({ error: { code: PAYME.PARSE }, id: null })

    expect((await call('ChangeSomething', {})).error).toMatchObject({ code: PAYME.METHOD_NOT_FOUND, data: 'ChangeSomething' })
  })

  it('CheckPerformTransaction: wrong amount -31001, unknown order -31050 naming the field, valid order allow with a receipt', async () => {
    expect((await call('CheckPerformTransaction', { amount: order1.amount + 100, account: { payment_id: order1.id } })).error?.code).toBe(PAYME.WRONG_AMOUNT)
    expect((await call('CheckPerformTransaction', { amount: order1.amount, account: { payment_id: 'no-such-order' } })).error).toMatchObject({ code: PAYME.ACCOUNT_NOT_FOUND, data: 'payment_id' })
    const ok = await call('CheckPerformTransaction', { amount: order1.amount, account: { payment_id: order1.id } })
    expect(ok.result).toMatchObject({ allow: true, detail: { receipt_type: 0, items: [{ price: order1.amount, count: 1, code: expect.any(String), package_code: expect.any(String), vat_percent: expect.any(Number) }] } })
  })

  it('scenario 1: create, repeat, check, second transaction -31008, cancel unconfirmed and repeat', async () => {
    const params = { id: tx1, time: Date.now(), amount: order1.amount, account: { payment_id: order1.id } }
    expect((await call('CreateTransaction', { ...params, amount: order1.amount + 100 })).error?.code).toBe(PAYME.WRONG_AMOUNT)
    expect((await call('CreateTransaction', { ...params, account: { payment_id: 'no-such-order' } })).error?.code).toBe(PAYME.ACCOUNT_NOT_FOUND)

    const created = await call('CreateTransaction', params)
    expect(created.result).toEqual({ create_time: expect.any(Number), transaction: expect.any(String), state: 1 })
    expect((await call('CreateTransaction', params)).result).toEqual(created.result)

    const checked = await call('CheckTransaction', { id: tx1 })
    expect(checked.result).toEqual({ create_time: created.result!.create_time, perform_time: 0, cancel_time: 0, transaction: created.result!.transaction, state: 1, reason: null })

    // The order is "waiting for payment": a new Payme transaction for it is refused.
    expect((await call('CreateTransaction', { ...params, id: `${tx1.slice(0, 20)}ffff` })).error?.code).toBe(PAYME.CANNOT_PERFORM)

    const cancelled = await call('CancelTransaction', { id: tx1, reason: 3 })
    expect(cancelled.result).toEqual({ transaction: created.result!.transaction, cancel_time: expect.any(Number), state: -1 })
    expect((await call('CancelTransaction', { id: tx1, reason: 3 })).result).toEqual(cancelled.result)
    expect((await call('CheckTransaction', { id: tx1 })).result).toMatchObject({ state: -1, reason: 3, cancel_time: cancelled.result!.cancel_time })

    await db(async () => {
      expect((await ctx.prisma.client.payment.findFirst({ where: { id: order1.id } }))?.state).toBe('CANCELLED')
    })
  })

  it('scenario 2: create, perform and repeat (subscription activated once), cancel after perform (refund) and repeat', async () => {
    const params = { id: tx2, time: Date.now(), amount: order2.amount, account: { payment_id: order2.id } }
    const created = await call('CreateTransaction', params)
    expect(created.result).toMatchObject({ state: 1 })

    const performed = await call('PerformTransaction', { id: tx2 })
    expect(performed.result).toEqual({ transaction: created.result!.transaction, perform_time: expect.any(Number), state: 2 })
    expect((await call('PerformTransaction', { id: tx2 })).result).toEqual(performed.result)
    expect((await call('CheckTransaction', { id: tx2 })).result).toMatchObject({ state: 2, perform_time: performed.result!.perform_time, cancel_time: 0 })
    await db(async () => {
      expect((await ctx.prisma.client.payment.findFirst({ where: { id: order2.id } }))?.state).toBe('PAID')
      expect((await ctx.prisma.client.subscription.findFirst({ where: { id: order2.subscriptionId } }))?.status).toBe('ACTIVE')
      expect(await ctx.prisma.client.ledgerJournal.count({ where: { referenceId: order2.id, kind: 'PAYMENT_SETTLED' } })).toBe(1)
    })

    const cancelled = await call('CancelTransaction', { id: tx2, reason: 5 })
    expect(cancelled.result).toEqual({ transaction: created.result!.transaction, cancel_time: expect.any(Number), state: -2 })
    expect((await call('CancelTransaction', { id: tx2, reason: 5 })).result).toEqual(cancelled.result)
    expect((await call('CheckTransaction', { id: tx2 })).result).toMatchObject({ state: -2, reason: 5 })
    await db(async () => {
      expect((await ctx.prisma.client.payment.findFirst({ where: { id: order2.id } }))?.state).toBe('REFUNDED')
      expect((await ctx.prisma.client.subscription.findFirst({ where: { id: order2.subscriptionId } }))?.status).toBe('CANCELLED')
    })
  })

  it('unknown transaction -31003; GetStatement lists the test transactions for the test key only', async () => {
    expect((await call('PerformTransaction', { id: 'ffffffffffffffffffffffff' })).error?.code).toBe(PAYME.TX_NOT_FOUND)
    expect((await call('CheckTransaction', { id: 'ffffffffffffffffffffffff' })).error?.code).toBe(PAYME.TX_NOT_FOUND)

    const window = { from: startedAt - 1000, to: Date.now() + 1000 }
    const sandbox = await call('GetStatement', window)
    const mine = (sandbox.result!.transactions as { id: string }[]).filter((t) => t.id === tx1 || t.id === tx2)
    expect(mine.map((t) => t.id)).toEqual([tx1, tx2])
    expect(mine[1]).toMatchObject({ amount: order2.amount, account: { payment_id: order2.id }, state: -2, reason: 5 })

    const live = await call('GetStatement', window, LIVE)
    expect((live.result!.transactions as { id: string }[]).some((t) => t.id === tx1 || t.id === tx2)).toBe(false)
  })
})
