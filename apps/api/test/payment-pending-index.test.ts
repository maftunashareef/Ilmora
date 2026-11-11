import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * One unpaid (PENDING) payment per subscription, held by the database (migration 20261118000000, «Доработки Ilmora»
 * Н6, re-check 11.11 №80): whatever path creates a payment, a second unpaid one for the same subscription fails.
 */
describe.skipIf(!DB_AVAILABLE)('one unpaid payment per subscription', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('refuses a second PENDING payment of the same subscription, allows a new one once the first is closed', async () => {
    const t = await ctx.makeTenant('pay-pending')
    const student = await ctx.makeStudent(t.tenantId)
    const { payment } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    expect(payment.state).toBe('PENDING')

    await TenantContext.forTenant(t.tenantId, async () => {
      const second = () => db.payment.create({
        data: {
          tenantId: t.tenantId, studentId: student.id, subscriptionId: payment.subscriptionId, periodStart: payment.periodStart,
          periodEnd: payment.periodEnd, amountMinor: payment.amountMinor, expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
      await expect(second()).rejects.toMatchObject({ code: 'P2002' })

      // A cancelled or paid payment does not count: the subscription can get a new unpaid one.
      await db.payment.update({ where: { id: payment.id }, data: { state: 'CANCELLED', cancelledAt: new Date() } })
      const fresh = await second()
      expect(fresh.state).toBe('PENDING')
      await expect(second()).rejects.toMatchObject({ code: 'P2002' })
    })
  })
})
