import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import { CommissionInput } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

/**
 * The price calculator (ТЗ 2026-11-18, раздел 9; Тимур, 20.11: the 5% minimum is for new courses, discount dates stay).
 * Every rule has a test that fails without its code (12.2): both examples of 9.2, the limits 5% and 90%, the price of a
 * new course, the snapshot in the payment, the commission only the Super Admin changes.
 */
describe.skipIf(!DB_AVAILABLE)('Price calculator (ТЗ 18.11, 9)', () => {
  const ctx = new TestContext()
  const manage = () =>
    new ManageService(
      ctx.prisma, ctx.audit,
      { generateForGroup: async () => 0, todayLocal: () => '2026-11-20' } as unknown as SessionsService,
      { get: async () => ({ permissions: { teacher: { editCourses: true, editPrices: true, publishDirectly: true, manageGroups: true, editSchedules: true } } }) } as unknown as SiteService,
      notificationsStub, ctx.env,
    )
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const err = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; response?: { code?: string } }) => e.code ?? e.response?.code ?? String(e))
  const L = { uz: 'Kurs', ru: 'Курс', en: 'Course' }
  const day = 86_400_000
  const live = (percent: number) => ({ percent, startsAt: new Date(Date.now() - day).toISOString(), endsAt: new Date(Date.now() + 30 * day).toISOString() })

  async function setup(label = 'calc') {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    return TenantContext.forTenant(t.tenantId, async () => {
      await db.center.update({ where: { id: t.center.id }, data: { status: 'ACTIVE', approvedAt: new Date() } })
      const admin = await db.user.create({ data: { tenantId: t.tenantId, login: `ca-${t.tenantId}`, displayName: 'Center', roles: ['CENTER_ADMIN'], centerId: t.center.id } })
      const center: RequestActor = { id: admin.id, roles: ['CENTER_ADMIN'], centerId: t.center.id }
      const ownerUser = await db.user.create({ data: { tenantId: t.tenantId, login: `own-${t.tenantId}`, displayName: 'Owner', roles: ['PLATFORM_ADMIN'], isOwner: true } })
      const owner: RequestActor = { id: ownerUser.id, roles: ['PLATFORM_ADMIN'], centerId: null }
      return { t, center, owner, tenantId: t.tenantId }
    })
  }
  type S = Awaited<ReturnType<typeof setup>>
  const as = <T>(s: S, actor: RequestActor, fn: () => Promise<T>) => TenantContext.forTenant(s.tenantId, fn, { actor })
  const body = (s: S, over: Record<string, unknown> = {}) => ({
    title: L, categoryId: s.t.category.id, centerId: s.t.center.id, teacherId: s.t.teacher.id, summary: L, description: L, curriculum: [], level: 'beginner' as const,
    durationMonths: 3, price: 1_000_000, status: 'draft' as const, ...over,
  })

  it('a new course: the price is whole thousands from 50 000 (or 0, free), the discount 5% … 100% − K', async () => {
    const s = await setup()
    const create = (over: Record<string, unknown>) => as(s, s.center, () => manage().createCourse(s.tenantId, s.center, body(s, over) as never))
    expect(await err(create({ price: 1_234_500 }))).toBe('course_price_invalid')
    expect(await err(create({ price: 40_000 }))).toBe('course_price_invalid')
    expect(await err(create({ price: 1_000_000, discount: live(91) }))).toBe('discount_over_limit')
    const ok = await create({ price: 1_234_000, discount: live(90) })
    expect(ok).toMatchObject({ price: 1_234_000, priceRule: 1, discount: { percent: 90 } })
    expect(await err(create({ price: 0, discount: live(5) }))).toBe('free_course_no_discount')
    await expect(create({ price: 0, status: 'published' })).resolves.toMatchObject({ price: 0, status: 'published' })
  })

  it('a paid new course is published only with a student discount (5% or more) that has not ended', async () => {
    const s = await setup()
    const m = manage()
    expect(await err(as(s, s.center, () => m.createCourse(s.tenantId, s.center, body(s, { status: 'published' }) as never)))).toBe('student_discount_required')
    const draft = await as(s, s.center, () => m.createCourse(s.tenantId, s.center, body(s) as never))
    expect(await err(as(s, s.center, () => m.updateCourse(s.tenantId, s.center, draft.id, { status: 'published' })))).toBe('student_discount_required')
    // An ended discount does not count.
    const ended = { percent: 10, startsAt: new Date(Date.now() - 10 * day).toISOString(), endsAt: new Date(Date.now() - day).toISOString() }
    expect(await err(as(s, s.center, () => m.updateCourse(s.tenantId, s.center, draft.id, { status: 'published', discount: ended })))).toBe('student_discount_required')
    await expect(as(s, s.center, () => m.updateCourse(s.tenantId, s.center, draft.id, { status: 'published', discount: live(5) }))).resolves.toMatchObject({ status: 'published' })
    // While published it keeps its discount: removing it is refused; editing the title is not.
    expect(await err(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, draft.id, null)))).toBe('student_discount_required')
    await expect(as(s, s.center, () => m.updateCourse(s.tenantId, s.center, draft.id, { title: { ...L, en: 'New' } }))).resolves.toMatchObject({ title: { en: 'New' } })
  })

  it('a course from before the calculator is not touched: no minimum, no price step, published without a discount', async () => {
    const s = await setup()
    const m = manage()
    // t.course: created before (priceRule 0), 50 000 so'm, published, no discount.
    await expect(as(s, s.center, () => m.updateCourse(s.tenantId, s.center, s.t.course.id, { price: 50_500, status: 'published' }))).resolves.toMatchObject({ price: 50_500, priceRule: 0 })
    await expect(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, s.t.course.id, null))).resolves.toBeTruthy()
    // A discount set now follows the new range on any course.
    expect(await err(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, s.t.course.id, live(91))))).toBe('discount_over_limit')
  })

  it('checkout: example 2 of 9.2 — 1 234 000 at 7% → 1 147 000; the payment keeps S, K and both shares; an older course keeps its rounding', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const course = await as(s, s.center, () => manage().createCourse(s.tenantId, s.center, body(s, { price: 1_234_000, discount: live(7), status: 'published' }) as never))
    const group = await TenantContext.forTenant(s.tenantId, () => db.group.create({ data: { tenantId: s.tenantId, courseId: course.id, name: 'C', days: [4], startTime: '10:00', endTime: '11:00', capacity: 5 } }))
    // The older course of the same checkout: 50 000 so'm at 7% → 46 500 (old rule, whole so'm).
    await TenantContext.forTenant(s.tenantId, () => db.course.update({ where: { id: s.t.course.id }, data: { discountPercent: 7, discountStartsAt: new Date(Date.now() - day), discountEndsAt: new Date(Date.now() + day) } }))
    const student = await ctx.makeStudent(s.tenantId)
    const { payment } = await ctx.checkout(s.tenantId, student.id, s.t.pkg.id, [group.id, s.t.group.id])
    const lines = await TenantContext.forTenant(s.tenantId, () => db.paymentLine.findMany({ where: { paymentId: payment.id } }))
    const byCourse = Object.fromEntries(lines.map((l) => [l.courseId, l]))
    expect(byCourse[course.id]).toMatchObject({ listPriceMinor: 123_400_000n, amountMinor: 114_700_000n, discountPercent: 7, commissionPercent: 10, centerShareMinor: 102_422_000n, platformShareMinor: 12_278_000n })
    expect(byCourse[s.t.course.id]).toMatchObject({ listPriceMinor: 5_000_000n, amountMinor: 4_650_000n, discountPercent: 7, commissionPercent: 10, centerShareMinor: 4_150_000n, platformShareMinor: 500_000n })
    expect(payment.amountMinor).toBe(114_700_000n + 4_650_000n)
  })

  it('example 1 and the limit: 1 000 000 at 5% → 950 000 / 850 000 / 100 000; at 90% the center gets 0', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const paid = async (percent: number) => {
      const c = await as(s, s.center, () => manage().createCourse(s.tenantId, s.center, body(s, { price: 1_000_000, discount: live(percent), status: 'published' }) as never))
      const g = await TenantContext.forTenant(s.tenantId, () => db.group.create({ data: { tenantId: s.tenantId, courseId: c.id, name: `G${percent}`, days: [5], startTime: '10:00', endTime: '11:00', capacity: 5 } }))
      const student = await ctx.makeStudent(s.tenantId)
      const { payment } = await ctx.checkout(s.tenantId, student.id, null as never, [g.id])
      return TenantContext.forTenant(s.tenantId, () => db.paymentLine.findFirstOrThrow({ where: { paymentId: payment.id } }))
    }
    expect(await paid(5)).toMatchObject({ amountMinor: 95_000_000n, centerShareMinor: 85_000_000n, platformShareMinor: 10_000_000n })
    expect(await paid(90)).toMatchObject({ amountMinor: 10_000_000n, centerShareMinor: 0n, platformShareMinor: 10_000_000n })
  })

  it('the commission: only the Super Admin, 2–50%, audited; new payments use the new one, a payment made keeps its own', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const m = manage()
    expect(CommissionInput.safeParse({ commissionPercent: 1 }).success).toBe(false)
    expect(CommissionInput.safeParse({ commissionPercent: 51 }).success).toBe(false)
    expect(CommissionInput.safeParse({ commissionPercent: 15, extra: 1 }).success).toBe(false)
    expect(await err(as(s, s.center, () => m.setCommission(s.tenantId, s.center, 15)))).toBe('forbidden')
    const course = await as(s, s.center, () => m.createCourse(s.tenantId, s.center, body(s, { price: 1_000_000, discount: live(5), status: 'published' }) as never))
    const group = await TenantContext.forTenant(s.tenantId, () => db.group.create({ data: { tenantId: s.tenantId, courseId: course.id, name: 'K', days: [6], startTime: '10:00', endTime: '11:00', capacity: 5 } }))
    const before = await ctx.checkout(s.tenantId, (await ctx.makeStudent(s.tenantId)).id, null as never, [group.id])
    await expect(as(s, s.owner, () => m.setCommission(s.tenantId, s.owner, 15))).resolves.toMatchObject({ commissionPercent: 15, minDiscountPercent: 5, maxDiscountPercent: 85 })
    const audit = await TenantContext.forTenant(s.tenantId, () => db.auditEvent.findFirstOrThrow({ where: { action: 'pricing.commission', entityId: s.tenantId } }))
    expect(audit).toMatchObject({ actorId: s.owner.id, before: { commissionPercent: 10 }, after: { commissionPercent: 15 } })
    const after = await ctx.checkout(s.tenantId, (await ctx.makeStudent(s.tenantId)).id, null as never, [group.id])
    const line = (id: string) => TenantContext.forTenant(s.tenantId, () => db.paymentLine.findFirstOrThrow({ where: { paymentId: id } }))
    expect(await line(before.payment.id)).toMatchObject({ commissionPercent: 10, centerShareMinor: 85_000_000n })
    expect(await line(after.payment.id)).toMatchObject({ commissionPercent: 15, amountMinor: 95_000_000n, centerShareMinor: 80_000_000n, platformShareMinor: 15_000_000n })
    // The limit moved with it: 86% is refused now.
    expect(await err(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, course.id, live(86))))).toBe('discount_over_limit')
    // The center sees it in its course list, and cannot change it.
    expect((await as(s, s.center, () => m.listCenterCourses(s.tenantId, s.center))).pricing).toEqual({ commissionPercent: 15, minDiscountPercent: 5, maxDiscountPercent: 85, minPriceSom: 50_000 })
  })
})
