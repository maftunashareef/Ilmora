import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { PAYME, PaymeError, PaymeService } from '../src/modules/payments/payme/payme.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'

describe.skipIf(!DB_AVAILABLE)('payments: Payme settlement', () => {
  const ctx = new TestContext()
  const env = testEnv({ PAYME_MERCHANT_ID: 'm1', PAYME_KEY: 'live-key-123456789012345678901234567', PAYME_TEST_KEY: 'test-key-12345678901234567890123456' })
  const payme = new PaymeService(ctx.prisma, ctx.payments, env)

  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('two concurrent PerformTransaction calls credit the payment exactly once', async () => {
    const t = await ctx.makeTenant('pay')
    const student = await ctx.makeStudent(t.tenantId)
    const { payment } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    const amount = Number(payment.amountMinor)
    const run = <T>(fn: () => Promise<T>) => TenantContext.system(fn, { tenantId: t.tenantId })

    const created = (await run(() => payme.handle('CreateTransaction', { id: `pm-${payment.id}`, time: Date.now(), amount, account: { payment_id: payment.id } }, false))) as { state: number }
    expect(created.state).toBe(1)
    const again = (await run(() => payme.handle('CreateTransaction', { id: `pm-${payment.id}`, time: Date.now(), amount, account: { payment_id: payment.id } }, false))) as { transaction: string }
    expect(again.transaction).toBeDefined()

    const results = await Promise.all([
      run(() => payme.handle('PerformTransaction', { id: `pm-${payment.id}` }, false)),
      run(() => payme.handle('PerformTransaction', { id: `pm-${payment.id}` }, false)),
      run(() => payme.handle('PerformTransaction', { id: `pm-${payment.id}` }, false)),
    ]) as { perform_time: number; state: number }[]
    expect(results.every((r) => r.state === 2)).toBe(true)
    expect(new Set(results.map((r) => r.perform_time)).size).toBe(1)

    await run(async () => {
      const paid = await ctx.prisma.client.payment.findFirst({ where: { id: payment.id } })
      expect(paid?.state).toBe('PAID')
      const journals = await ctx.prisma.client.ledgerJournal.findMany({ where: { referenceType: 'Payment', referenceId: payment.id, kind: 'PAYMENT_SETTLED' } })
      expect(journals).toHaveLength(1)
      const entries = await ctx.prisma.client.ledgerEntry.findMany({ where: { journalId: journals[0].id } })
      expect(entries.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + e.amountMinor, 0n)).toBe(payment.amountMinor)
      const sub = await ctx.prisma.client.subscription.findFirst({ where: { id: payment.subscriptionId } })
      expect(sub?.status).toBe('ACTIVE')
      const enrollments = await ctx.prisma.client.enrollment.findMany({ where: { subscriptionId: payment.subscriptionId } })
      expect(enrollments.map((e) => e.status)).toEqual(['ACTIVE', 'ACTIVE'])
      const outbox = await ctx.prisma.client.outboxEvent.findMany({ where: { dedupeKey: `receipt:${payment.id}` } })
      expect(outbox).toHaveLength(1)
    })
  })

  it('rejects wrong amounts, unknown orders and a second transaction for a pending order', async () => {
    const t = await ctx.makeTenant('pay')
    const student = await ctx.makeStudent(t.tenantId)
    const { payment } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    const run = <T>(fn: () => Promise<T>) => TenantContext.system(fn, { tenantId: t.tenantId })
    const amount = Number(payment.amountMinor)
    await expect(run(() => payme.handle('CheckPerformTransaction', { amount: amount + 1, account: { payment_id: payment.id } }, false))).rejects.toMatchObject({ code: PAYME.WRONG_AMOUNT })
    await expect(run(() => payme.handle('CheckPerformTransaction', { amount, account: { payment_id: 'nope' } }, false))).rejects.toMatchObject({ code: PAYME.ACCOUNT_NOT_FOUND })
    const first = `first-${payment.id}`
    await run(() => payme.handle('CreateTransaction', { id: first, time: Date.now(), amount, account: { payment_id: payment.id } }, false))
    await expect(run(() => payme.handle('CreateTransaction', { id: `second-${payment.id}`, time: Date.now(), amount, account: { payment_id: payment.id } }, false))).rejects.toMatchObject({ code: PAYME.CANNOT_PERFORM })
    // cancel before perform releases the seat hold
    const cancelled = (await run(() => payme.handle('CancelTransaction', { id: first, reason: 3 }, false))) as { state: number }
    expect(cancelled.state).toBe(-1)
    await run(async () => {
      expect((await ctx.prisma.client.payment.findFirst({ where: { id: payment.id } }))?.state).toBe('CANCELLED')
      expect((await ctx.prisma.client.enrollment.findMany({ where: { subscriptionId: payment.subscriptionId } })).every((e) => e.status === 'CANCELLED')).toBe(true)
    })
    const repeat = (await run(() => payme.handle('CancelTransaction', { id: first, reason: 3 }, false))) as { state: number }
    expect(repeat.state).toBe(-1)
  })

  it('authenticates Payme with the live key and refuses bad credentials', () => {
    const ok = Buffer.from(`Paycom:${env.PAYME_KEY}`).toString('base64')
    expect(payme.authenticate(`Basic ${ok}`)).toEqual({ sandbox: false })
    expect(() => payme.authenticate(`Basic ${Buffer.from('Paycom:wrong').toString('base64')}`)).toThrow(PaymeError)
    expect(() => payme.authenticate(undefined)).toThrow(PaymeError)
  })

  it('capacity: the last seat cannot be sold twice under concurrent checkouts', async () => {
    const t = await ctx.makeTenant('cap') // group capacity = 2
    const students = await Promise.all([1, 2, 3].map((n) => ctx.makeStudent(t.tenantId, 70_000 + n)))
    const outcomes = await Promise.allSettled(students.map((s) => ctx.checkout(t.tenantId, s.id, t.pkg.id, [t.group.id, t.group2.id])))
    const ok = outcomes.filter((o) => o.status === 'fulfilled').length
    const full = outcomes.filter((o) => o.status === 'rejected' && String((o as PromiseRejectedResult).reason?.code) === 'full').length
    expect(ok).toBe(2)
    expect(full).toBe(1)
  })
})
