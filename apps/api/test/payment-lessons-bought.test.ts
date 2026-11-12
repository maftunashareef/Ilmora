import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * №78 (re-check 11.11): the lessons each payment of a «per lessons» package buys (migration 20261123000000). The
 * backfill of existing payments is run here from the migration file itself on payments with known histories.
 */
const MIGRATION = join(__dirname, '../prisma/migrations/20261123000000_payment_lessons_bought/migration.sql')
const backfill = (() => {
  const text = readFileSync(MIGRATION, 'utf8')
  const start = text.indexOf('WITH settled AS')
  return text.slice(start, text.indexOf(';', start) + 1)
})()

describe.skipIf(!DB_AVAILABLE)('payment lessons bought', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('is never negative', async () => {
    const t = await ctx.makeTenant('lessons-check')
    const student = await ctx.makeStudent(t.tenantId)
    const { payment } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    await TenantContext.forTenant(t.tenantId, async () => {
      await expect(db.payment.update({ where: { id: payment.id }, data: { lessonsBought: -1 } })).rejects.toThrow(/Payment_lessonsBought_check/)
      await db.payment.update({ where: { id: payment.id }, data: { lessonsBought: 0 } })
    })
  })

  it('fills old payments: exact for a single settled payment, the package count otherwise, nothing for PERIOD', async () => {
    const t = await ctx.makeTenant('lessons-fill')
    const tenantId = t.tenantId
    await TenantContext.forTenant(tenantId, async () => {
      // The package sold 10 lessons a payment, now 8: what the backfill can and cannot know.
      const pkg = await db.package.update({ where: { id: t.pkg.id }, data: { accessKind: 'LESSONS', lessonCount: 8 } })
      const day = 86_400_000
      const sub = async (kind: 'LESSONS' | 'PERIOD', lessonsTotal: number | null) => {
        const student = await ctx.makeStudent(tenantId)
        return db.subscription.create({ data: { tenantId, studentId: student.id, packageId: pkg.id, status: 'ACTIVE', kind, lessonsTotal } })
      }
      const pay = (s: { id: string; studentId: string }, state: 'PAID' | 'REFUNDED' | 'PENDING' | 'CANCELLED', n: number) =>
        db.payment.create({
          data: {
            tenantId, studentId: s.studentId, subscriptionId: s.id, state, amountMinor: 100_000_00n,
            refundedMinor: state === 'REFUNDED' ? 100_000_00n : 0n,
            periodStart: new Date(Date.now() - (10 - n) * day), periodEnd: new Date(Date.now() + n * day), expiresAt: new Date(Date.now() + day),
          },
        })

      const single = await sub('LESSONS', 10) // one payment of 10 lessons (the package said 10 then)
      const singlePaid = await pay(single, 'PAID', 1)
      const singleRetry = await pay(single, 'CANCELLED', 2) // an abandoned checkout before it

      const renewed = await sub('LESSONS', 13) // 10 + a renewal: cannot be split exactly
      const renewedFirst = await pay(renewed, 'PAID', 1)
      const renewedSecond = await pay(renewed, 'PAID', 2)

      const refunded = await sub('LESSONS', 10) // its only payment was cancelled in Payme
      const refundedPay = await pay(refunded, 'REFUNDED', 1)

      const waiting = await sub('LESSONS', null) // not paid yet
      const waitingPay = await pay(waiting, 'PENDING', 1)

      const monthly = await sub('PERIOD', null)
      const monthlyPay = await pay(monthly, 'PAID', 1)

      await db.payment.updateMany({ where: { tenantId }, data: { lessonsBought: null } })
      await TenantContext.system(() => db.$executeRawUnsafe(backfill))

      const bought = async (id: string) => (await db.payment.findFirstOrThrow({ where: { id } })).lessonsBought
      expect(await bought(singlePaid.id)).toBe(10) // exact: the subscription's total
      expect(await bought(singleRetry.id)).toBe(8) // never settled: the package now
      expect(await bought(renewedFirst.id)).toBe(8)
      expect(await bought(renewedSecond.id)).toBe(8)
      expect(await bought(refundedPay.id)).toBe(10)
      expect(await bought(waitingPay.id)).toBe(8)
      expect(await bought(monthlyPay.id)).toBeNull()
    })
  })
})
