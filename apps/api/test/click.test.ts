import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createHash } from 'node:crypto'
import { somToTiyin, tiyinToClickAmount } from '@ilmora/shared'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { configureBodyParsing } from '../src/body-parsing'
import { clickConfigured, ENV, validateEnv } from '../src/config/env'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { ClickController } from '../src/modules/payments/click/click.controller'
import { CLICK, type ClickForm, ClickService } from '../src/modules/payments/click/click.service'
import { PAYME, PaymeService } from '../src/modules/payments/payme/payme.service'
import { PaymentsService } from '../src/modules/payments/payments.service'
import { ReconciliationService } from '../src/modules/payments/reconciliation.service'
import { PrismaService as RealPrisma } from '../src/infra/prisma/prisma.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'

const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const CLICK_ENV = { CLICK_SERVICE_ID: '77', CLICK_MERCHANT_ID: '1', CLICK_SECRET_KEY: 'click-secret' }
const SIGN_TIME = '2026-11-23 12:00:00'

/** A signed Click form, as Click sends it: Prepare without merchant_prepare_id, Complete with it. */
function signed(f: { clickTransId: string; paymentId: string; amount: string; action: 0 | 1; prepareId?: string; error?: string; secret?: string; serviceId?: string }): ClickForm {
  const serviceId = f.serviceId ?? '77'
  const secret = f.secret ?? 'click-secret'
  const sign = f.action === 0
    ? md5(`${f.clickTransId}${serviceId}${secret}${f.paymentId}${f.amount}0${SIGN_TIME}`)
    : md5(`${f.clickTransId}${serviceId}${secret}${f.paymentId}${f.prepareId}${f.amount}1${SIGN_TIME}`)
  return {
    click_trans_id: f.clickTransId, service_id: serviceId, click_paydoc_id: '1', merchant_trans_id: f.paymentId, amount: f.amount, action: String(f.action),
    error: f.error ?? '0', error_note: 'Success', sign_time: SIGN_TIME, sign_string: sign, ...(f.action === 1 ? { merchant_prepare_id: f.prepareId } : {}),
  }
}

/** Prisma that fails any query: proves a code path never reaches the database. */
const noDatabase = new Proxy({}, { get: () => { throw new Error('the database was reached') } }) as unknown as PrismaService

describe('Click settings (security review 10.11 №5: a service id without the secret)', () => {
  const prod = { NODE_ENV: 'production', CORS_ORIGINS: 'https://ilmoraa.uz', COOKIE_SECURE: 'true', SMS_PROVIDER: 'eskiz', REDIS_MODE: 'redis', TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') }

  it('production refuses to start with a part of the Click settings', () => {
    for (const partial of [{ CLICK_SERVICE_ID: '77' }, { CLICK_SERVICE_ID: '77', CLICK_MERCHANT_ID: '1' }, { CLICK_SECRET_KEY: 's' }]) {
      expect(() => validateEnv({ ...process.env, ...prod, ...partial })).toThrow(/Click is configured partly/)
    }
    expect(() => validateEnv({ ...process.env, ...prod, ...CLICK_ENV })).not.toThrow()
    expect(() => validateEnv({ ...process.env, ...prod })).not.toThrow()
  })

  it('a part of the settings is «Click off»: no signature passes, even one made with an empty secret', () => {
    const env = testEnv({ CLICK_SERVICE_ID: '77', CLICK_MERCHANT_ID: '1' })
    expect(clickConfigured(env)).toBe(false)
    const click = new ClickService(noDatabase, {} as PaymentsService, env)
    expect(click.verifySign(signed({ clickTransId: '5', paymentId: 'pay-1', amount: '1000.00', action: 0, secret: '' }), 0)).toBe(false)
  })

  it('checkout offers Click only when fully configured, with Click\'s payment link', () => {
    const off = new PaymentsService({} as never, {} as never, {} as never, {} as never, {} as never, testEnv({ CLICK_SERVICE_ID: '77' }))
    expect(off.providersAvailable()).toMatchObject({ CLICK: false })
    expect(() => off.checkoutLink({ id: 'pay-1', amountMinor: 100n, provider: 'CLICK', expiresAt: new Date() }, 'CLICK', 'ru')).toThrow(/Click is not configured/)
    const on = new PaymentsService({} as never, {} as never, {} as never, {} as never, {} as never, testEnv({ ...CLICK_ENV, PUBLIC_WEB_URL: 'https://ilmoraa.uz' }))
    expect(on.providersAvailable()).toMatchObject({ CLICK: true })
    const link = on.checkoutLink({ id: 'pay-1', amountMinor: 1_725_000_00n, provider: 'CLICK', expiresAt: new Date() }, 'CLICK', 'ru')
    const url = new URL(link.url!)
    expect(`${url.origin}${url.pathname}`).toBe('https://my.click.uz/services/pay/')
    expect(Object.fromEntries(url.searchParams)).toEqual({ service_id: '77', merchant_id: '1', amount: '1725000.00', transaction_param: 'pay-1', return_url: 'https://ilmoraa.uz/ru/payments/pay-1/return' })
  })
})

describe('Click protocol', () => {
  const env = testEnv(CLICK_ENV)
  const click = new ClickService(noDatabase, {} as PaymentsService, env)

  it('checks the Prepare signature over the received values, and the Complete one with merchant_prepare_id', () => {
    const prepare = signed({ clickTransId: '12345678', paymentId: 'pay-001', amount: '50000.00', action: 0 })
    expect(click.verifySign(prepare, 0)).toBe(true)
    expect(click.verifySign({ ...prepare, sign_string: 'deadbeef' }, 0)).toBe(false)
    expect(click.verifySign({ ...prepare, amount: '50000.01' }, 0)).toBe(false)
    const complete = signed({ clickTransId: '12345678', paymentId: 'pay-001', amount: '50000.00', action: 1, prepareId: '999' })
    expect(click.verifySign(complete, 1)).toBe(true)
    expect(click.verifySign({ ...complete, merchant_prepare_id: '998' }, 1)).toBe(false)
    // A form signed with another secret.
    expect(click.verifySign(signed({ clickTransId: '1', paymentId: 'p', amount: '1.00', action: 0, secret: 'other' }), 0)).toBe(false)
  })

  it('refuses before the database: an unreadable request (-8), another service (-8), a bad signature (-1), a bad amount (-2)', async () => {
    const good = signed({ clickTransId: '5', paymentId: 'pay-1', amount: '1000.00', action: 0 })
    expect((await click.prepare({ ...good, click_trans_id: 'x5' })).error).toBe(CLICK.BAD_REQUEST)
    expect((await click.prepare({ ...good, merchant_trans_id: '' })).error).toBe(CLICK.BAD_REQUEST)
    expect((await click.prepare(signed({ clickTransId: '5', paymentId: 'pay-1', amount: '1000.00', action: 0, serviceId: '78' }))).error).toBe(CLICK.BAD_REQUEST)
    expect((await click.prepare({ ...good, sign_string: 'deadbeef' })).error).toBe(CLICK.SIGN_FAILED)
    expect((await click.prepare(signed({ clickTransId: '5', paymentId: 'pay-1', amount: '1e3', action: 0 }))).error).toBe(CLICK.WRONG_AMOUNT)
    expect((await click.prepare(signed({ clickTransId: '5', paymentId: 'pay-1', amount: '0.00', action: 0 }))).error).toBe(CLICK.WRONG_AMOUNT)
    expect((await click.complete({ ...signed({ clickTransId: '5', paymentId: 'pay-1', amount: '1000.00', action: 1, prepareId: '7' }), merchant_prepare_id: undefined })).error).toBe(CLICK.BAD_REQUEST)
  })

  it('converts so\'m with two decimals exactly and answers in Click\'s shape', () => {
    expect(tiyinToClickAmount(50_000_00n)).toBe('50000.00')
    expect(tiyinToClickAmount(12_345_67n)).toBe('12345.67')
    expect(somToTiyin('12345.67')).toBe(12_345_67n)
    expect(click.reply({ click_trans_id: '123', merchant_trans_id: 'pay-01' }, CLICK.ALREADY_PAID, { merchant_confirm_id: 42 })).toEqual({ click_trans_id: 123, merchant_trans_id: 'pay-01', merchant_confirm_id: 42, error: -4, error_note: 'Already paid' })
  })
})

describe('Click callbacks over HTTP (form-urlencoded in, JSON out)', () => {
  let app: INestApplication | undefined
  afterEach(async () => { await app?.close(); app = undefined })

  const start = async (env: ReturnType<typeof testEnv>, click: object) => {
    const prisma = { client: { providerCallbackLog: { create: vi.fn(async () => ({})) } } }
    @Module({ controllers: [ClickController], providers: [{ provide: ClickService, useValue: click }, { provide: RealPrisma, useValue: prisma }, { provide: ENV, useValue: env }] })
    class ClickOnlyModule {}
    const created = await NestFactory.create<NestExpressApplication>(ClickOnlyModule, { logger: false, rawBody: true, bodyParser: false })
    configureBodyParsing(created)
    await created.init()
    app = created
    return created
  }

  it('reads the form fields of a Prepare', async () => {
    const real = new ClickService(noDatabase, {} as PaymentsService, testEnv(CLICK_ENV))
    const click = { configured: () => true, reply: real.reply.bind(real), tenantFor: async () => null, prepare: vi.fn(async (form: ClickForm) => real.reply(form, CLICK.OK, { merchant_prepare_id: 9 })) }
    const a = await start(testEnv(CLICK_ENV), click)
    const res = await request(a.getHttpServer()).post('/payments/click/prepare').type('form').send({ click_trans_id: '555', service_id: '77', merchant_trans_id: 'pay-1', amount: '1000.00', action: '0', sign_time: SIGN_TIME, sign_string: 'x' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ click_trans_id: 555, merchant_trans_id: 'pay-1', merchant_prepare_id: 9, error: 0, error_note: 'Success' })
    expect(click.prepare).toHaveBeenCalledWith(expect.objectContaining({ click_trans_id: '555', amount: '1000.00', action: '0' }))
  })

  it('Click off answers -8 to everything and looks up nothing (security review №5)', async () => {
    const env = testEnv({ CLICK_SERVICE_ID: '77', CLICK_MERCHANT_ID: '1' })
    const a = await start(env, new ClickService(noDatabase, {} as PaymentsService, env))
    for (const path of ['/payments/click/prepare', '/payments/click/complete']) {
      const res = await request(a.getHttpServer()).post(path).type('form').send({ ...signed({ clickTransId: '5', paymentId: 'pay-1', amount: '1.00', action: path.endsWith('prepare') ? 0 : 1, prepareId: '1', secret: '' }) })
      expect(res.body).toMatchObject({ error: CLICK.BAD_REQUEST })
    }
  })

  it('a Complete sent to the Prepare address is «action not found» (-3)', async () => {
    const env = testEnv(CLICK_ENV)
    const a = await start(env, new ClickService(noDatabase, {} as PaymentsService, env))
    const res = await request(a.getHttpServer()).post('/payments/click/prepare').type('form').send(signed({ clickTransId: '5', paymentId: 'pay-1', amount: '1.00', action: 1, prepareId: '1' }))
    expect(res.body).toMatchObject({ error: CLICK.ACTION_NOT_FOUND })
  })
})

describe.skipIf(!DB_AVAILABLE)('Click on the database', () => {
  const ctx = new TestContext()
  const env = testEnv(CLICK_ENV)
  const click = new ClickService(ctx.prisma, ctx.payments, env)
  const payme = new PaymeService(ctx.prisma, ctx.payments, testEnv({ PAYME_MERCHANT_ID: 'm1', PAYME_KEY: 'live-key-123456789012345678901234567' }))
  const recon = new ReconciliationService(ctx.prisma)
  let n = Date.now() % 1_000_000_000

  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  async function invoice() {
    const t = await ctx.makeTenant('clk')
    const student = await ctx.makeStudent(t.tenantId)
    const { payment } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    const run = <T>(fn: () => Promise<T>) => TenantContext.system(fn, { tenantId: t.tenantId })
    const amount = tiyinToClickAmount(payment.amountMinor)
    const attempt = () => String(++n)
    const prepare = (clickTransId: string) => run(() => click.prepare(signed({ clickTransId, paymentId: payment.id, amount, action: 0 })))
    const complete = (clickTransId: string, prepareId: number | undefined, error = '0') => run(() => click.complete(signed({ clickTransId, paymentId: payment.id, amount, action: 1, prepareId: String(prepareId), error })))
    const state = () => run(async () => (await ctx.prisma.client.payment.findFirst({ where: { id: payment.id } }))!.state)
    const rows = () => run(() => ctx.prisma.client.paymentTransaction.findMany({ where: { paymentId: payment.id }, orderBy: { createdAt: 'asc' } }))
    const reconciliation = () => run(() => recon.list(t.tenantId, { provider: 'CLICK' }))
    return { t, payment, run, amount, attempt, prepare, complete, state, rows, reconciliation }
  }

  it('Prepare and Complete settle once; concurrent and repeated Complete answer «already paid»', async () => {
    const inv = await invoice()
    const id = inv.attempt()
    const prepared = await inv.prepare(id)
    expect(prepared).toMatchObject({ error: 0 })
    expect(await inv.prepare(id)).toMatchObject({ error: 0, merchant_prepare_id: prepared.merchant_prepare_id })
    const [a, b] = await Promise.all([inv.complete(id, prepared.merchant_prepare_id), inv.complete(id, prepared.merchant_prepare_id)])
    expect([a.error, b.error].sort()).toEqual([-4, 0])
    expect(await inv.state()).toBe('PAID')
    await inv.run(async () => expect(await ctx.prisma.client.ledgerJournal.count({ where: { referenceId: inv.payment.id, kind: 'PAYMENT_SETTLED' } })).toBe(1))
    expect((await inv.complete(id, prepared.merchant_prepare_id)).error).toBe(CLICK.ALREADY_PAID)
    expect((await inv.prepare(inv.attempt())).error).toBe(CLICK.ALREADY_PAID)
    expect((await inv.reconciliation()).items.every((r) => r.discrepancy === null)).toBe(true)
  })

  it('security review №6: a second Click attempt on one invoice is refused while the first runs — no second debit', async () => {
    const inv = await invoice()
    const first = inv.attempt()
    const second = inv.attempt()
    const p1 = await inv.prepare(first)
    expect(p1.error).toBe(0)
    expect((await inv.prepare(second)).error).toBe(CLICK.CANCELLED)
    expect((await inv.complete(first, p1.merchant_prepare_id)).error).toBe(0)
    expect((await inv.prepare(second)).error).toBe(CLICK.ALREADY_PAID)
    expect((await inv.rows()).map((r) => [r.providerTransactionId, r.state])).toEqual([[first, 'PERFORMED']])
  })

  it('security review №6: Payme and Click do not run on one invoice at the same time', async () => {
    const viaClick = await invoice()
    const amountMinor = Number(viaClick.payment.amountMinor)
    expect((await viaClick.prepare(viaClick.attempt())).error).toBe(0)
    await expect(viaClick.run(() => payme.handle('CreateTransaction', { id: `pm-${viaClick.payment.id}`, time: Date.now(), amount: amountMinor, account: { payment_id: viaClick.payment.id } }, false))).rejects.toMatchObject({ code: PAYME.CANNOT_PERFORM })

    const viaPayme = await invoice()
    await viaPayme.run(() => payme.handle('CreateTransaction', { id: `pm-${viaPayme.payment.id}`, time: Date.now(), amount: Number(viaPayme.payment.amountMinor), account: { payment_id: viaPayme.payment.id } }, false))
    expect((await viaPayme.prepare(viaPayme.attempt())).error).toBe(CLICK.CANCELLED)
  })

  it('an attempt abandoned after Prepare stops blocking after CLICK_PENDING_MINUTES; its late Complete is cancelled and flagged', async () => {
    const inv = await invoice()
    const abandoned = inv.attempt()
    const p1 = await inv.prepare(abandoned)
    await inv.run(() => ctx.prisma.client.paymentTransaction.updateMany({ where: { paymentId: inv.payment.id }, data: { createdAt: new Date(Date.now() - (env.CLICK_PENDING_MINUTES + 1) * 60_000) } }))
    const next = inv.attempt()
    const p2 = await inv.prepare(next)
    expect(p2.error).toBe(0)
    expect((await inv.rows()).map((r) => [r.providerTransactionId, r.state, r.cancelReason])).toEqual([[abandoned, 'CANCELLED', 4], [next, 'CREATED', null]])
    expect((await inv.complete(next, p2.merchant_prepare_id)).error).toBe(0)
    // Click says it took the money for the abandoned attempt: «cancelled» (Click returns it), and finance is asked to check.
    expect((await inv.complete(abandoned, p1.merchant_prepare_id)).error).toBe(CLICK.CANCELLED)
    const flagged = (await inv.reconciliation()).items.find((r) => r.providerTransactionId === abandoned)
    expect(flagged?.discrepancy).toBe('check_with_provider')
    expect(await inv.state()).toBe('PAID')
  })

  it('a Complete Click failed (error < 0) closes only that attempt: the invoice stays open for another try', async () => {
    const inv = await invoice()
    const failed = inv.attempt()
    const p1 = await inv.prepare(failed)
    expect((await inv.complete(failed, p1.merchant_prepare_id, '-5017')).error).toBe(CLICK.CANCELLED)
    expect(await inv.state()).toBe('PENDING')
    const retry = inv.attempt()
    const p2 = await inv.prepare(retry)
    expect(p2.error).toBe(0)
    expect((await inv.complete(retry, p2.merchant_prepare_id)).error).toBe(0)
    expect(await inv.state()).toBe('PAID')
  })

  it('the seat hold waits for a running Click attempt, not for an abandoned one', async () => {
    const inv = await invoice()
    const id = inv.attempt()
    expect((await inv.prepare(id)).error).toBe(0)
    await inv.run(() => ctx.prisma.client.payment.update({ where: { id: inv.payment.id }, data: { expiresAt: new Date(Date.now() - 60_000) } }))
    await TenantContext.forTenant(inv.t.tenantId, () => ctx.subscriptions.expirePending(inv.t.tenantId))
    expect(await inv.state()).toBe('PENDING')
    await inv.run(() => ctx.prisma.client.paymentTransaction.updateMany({ where: { paymentId: inv.payment.id }, data: { createdAt: new Date(Date.now() - (env.CLICK_PENDING_MINUTES + 1) * 60_000) } }))
    await TenantContext.forTenant(inv.t.tenantId, () => ctx.subscriptions.expirePending(inv.t.tenantId))
    expect(await inv.state()).toBe('EXPIRED')
    expect((await inv.rows()).map((r) => [r.state, r.cancelReason])).toEqual([['CANCELLED', 4]])
  })

  it('security review №6: money Click took for an invoice that was cancelled meanwhile is «refund_required» in the reconciliation', async () => {
    const inv = await invoice()
    const id = inv.attempt()
    const p1 = await inv.prepare(id)
    await TenantContext.forTenant(inv.t.tenantId, () => ctx.subscriptions.cancel(inv.t.tenantId, inv.payment.studentId!))
    expect(await inv.state()).toBe('CANCELLED')
    // Click debits before Complete: its rules want «success», and the money back.
    expect((await inv.complete(id, p1.merchant_prepare_id)).error).toBe(0)
    const row = (await inv.reconciliation()).items.find((r) => r.providerTransactionId === id)
    expect(row).toMatchObject({ transactionState: 'PERFORMED', paymentState: 'CANCELLED', discrepancy: 'refund_required' })
    await inv.run(async () => expect(await ctx.prisma.client.outboxEvent.count({ where: { dedupeKey: `click-refund:${row!.transactionId}`, type: 'payment.refund_required' } })).toBe(1))
    await inv.run(async () => expect(await ctx.prisma.client.ledgerJournal.count({ where: { referenceId: inv.payment.id, kind: 'PAYMENT_SETTLED' } })).toBe(0))
  })
})
