import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

describe.skipIf(!DB_AVAILABLE)('flexible cart: custom selection without a package', () => {
  const ctx = new TestContext()

  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const saveDraft = (tenantId: string, studentId: string, groupIds: string[], packageId: string | null = null) =>
    TenantContext.forTenant(tenantId, () => ctx.subscriptions.saveDraft(tenantId, studentId, { packageId, groupIds, meyosGrant: false }))
  const checkout = (tenantId: string, studentId: string) => TenantContext.forTenant(tenantId, () => ctx.subscriptions.checkout(tenantId, studentId, 'PAYME'))
  const extraGroup = (tenantId: string, courseId: string, data: { days: number[]; startTime: string; endTime: string }) =>
    TenantContext.system(() => ctx.prisma.client.group.create({ data: { tenantId, courseId, name: 'X', capacity: 5, ...data } }))

  it('sells a single course without a package at the course price', async () => {
    const t = await ctx.makeTenant('cart')
    const student = await ctx.makeStudent(t.tenantId)
    await saveDraft(t.tenantId, student.id, [t.group.id])
    const { subscription, payment } = await checkout(t.tenantId, student.id)
    expect(subscription.packageId).toBeNull()
    expect(payment.amountMinor).toBe(t.course.priceMinor)
    expect(subscription.amountMinor).toBe(t.course.priceMinor)
  })

  it('sells several courses as the sum of the server-side course prices', async () => {
    const t = await ctx.makeTenant('cart')
    const student = await ctx.makeStudent(t.tenantId)
    await saveDraft(t.tenantId, student.id, [t.group.id, t.group2.id])
    const { payment } = await checkout(t.tenantId, student.id)
    expect(payment.amountMinor).toBe(t.course.priceMinor + t.course2.priceMinor)
  })

  it('rejects the same course twice, overlapping schedules and removed groups', async () => {
    const t = await ctx.makeTenant('cart')
    const student = await ctx.makeStudent(t.tenantId)
    const sameCourse = await extraGroup(t.tenantId, t.course.id, { days: [4], startTime: '10:00', endTime: '11:00' })
    await expect(saveDraft(t.tenantId, student.id, [t.group.id, sameCourse.id])).rejects.toMatchObject({ code: 'duplicate' })

    const overlapping = await extraGroup(t.tenantId, t.course2.id, { days: [0, 2], startTime: '18:30', endTime: '19:30' })
    await expect(saveDraft(t.tenantId, student.id, [t.group.id, overlapping.id])).rejects.toMatchObject({ code: 'conflict' })

    await TenantContext.system(() => ctx.prisma.client.group.update({ where: { id: sameCourse.id }, data: { deletedAt: new Date() } }))
    await expect(saveDraft(t.tenantId, student.id, [sameCourse.id])).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses to check out an empty custom selection', async () => {
    const t = await ctx.makeTenant('cart')
    const student = await ctx.makeStudent(t.tenantId)
    await saveDraft(t.tenantId, student.id, [])
    await expect(checkout(t.tenantId, student.id)).rejects.toMatchObject({ code: 'incomplete' })
  })

  it('keeps Duo/Trio strict: a package needs exactly its number of courses', async () => {
    const t = await ctx.makeTenant('cart')
    const student = await ctx.makeStudent(t.tenantId)
    await saveDraft(t.tenantId, student.id, [t.group.id], t.pkg.id)
    await expect(checkout(t.tenantId, student.id)).rejects.toMatchObject({ code: 'incomplete' })
    await saveDraft(t.tenantId, student.id, [t.group.id, t.group2.id], t.pkg.id)
    const { subscription } = await checkout(t.tenantId, student.id)
    expect(subscription.packageId).toBe(t.pkg.id)
  })

  it('a new checkout replaces an unpaid one, but a paid subscription still allows no second one', async () => {
    const t = await ctx.makeTenant('cart')
    const student = await ctx.makeStudent(t.tenantId)
    const run = <T>(fn: () => Promise<T>) => TenantContext.system(fn, { tenantId: t.tenantId })
    await saveDraft(t.tenantId, student.id, [t.group.id])
    const first = await checkout(t.tenantId, student.id)
    // The first payment never happened (abandoned, failed or cancelled by the bank): the student simply checks out again.
    await saveDraft(t.tenantId, student.id, [t.group2.id])
    const second = await checkout(t.tenantId, student.id)
    expect(second.subscription.id).not.toBe(first.subscription.id)
    await run(async () => {
      expect((await ctx.prisma.client.subscription.findFirst({ where: { id: first.subscription.id } }))?.status).toBe('CANCELLED')
      expect((await ctx.prisma.client.payment.findFirst({ where: { id: first.payment.id } }))?.state).toBe('CANCELLED')
      expect((await ctx.prisma.client.enrollment.findMany({ where: { subscriptionId: first.subscription.id } })).every((e) => e.status === 'CANCELLED')).toBe(true)
      expect((await ctx.prisma.client.subscription.findFirst({ where: { id: second.subscription.id } }))?.status).toBe('PENDING_PAYMENT')
    })
    // Once paid, the subscription is open for real and a further checkout conflicts.
    await TenantContext.forTenant(t.tenantId, () => ctx.payments.manualSettle(second.payment.id, student.id, 'cash at the desk'))
    await saveDraft(t.tenantId, student.id, [t.group.id])
    await expect(checkout(t.tenantId, student.id)).rejects.toMatchObject({ code: 'subscription_exists' })
  })
})
