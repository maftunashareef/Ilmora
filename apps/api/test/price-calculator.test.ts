import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import { CommissionInput } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

/**
 * The price calculator (ТЗ 2026-11-18, раздел 9; Шерзод, 20.11: the 5% minimum is for new courses; 22.11: the center chooses
 * a permanent or a time-limited discount, and after a time-limited one a paid new course keeps the minimum).
 * Every rule has a test that fails without its code (12.2): both examples of 9.2, the limits 5% and 90%, the price of a
 * new course, the snapshot in the payment, the commission only the Super Admin changes.
 * 23.11 (the owner): a course of the calculator (priceRule 1) splits the center's total percent in equal halves — the
 * student's discount S (5% … 50%) and ILMORA's commission S; the Super Admin's K stays for courses from before it.
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
  /** A permanent discount: started yesterday, no end. */
  const live = (percent: number) => ({ percent, startsAt: new Date(Date.now() - day).toISOString(), endsAt: null })
  /** A time-limited discount: started yesterday, ends in 30 days. */
  const windowed = (percent: number) => ({ percent, startsAt: new Date(Date.now() - day).toISOString(), endsAt: new Date(Date.now() + 30 * day).toISOString() })

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

  it('a new course: the price is whole thousands from 50 000 (or 0, free), the student\'s half 5% … 50% (a total of 100%)', async () => {
    const s = await setup()
    const create = (over: Record<string, unknown>) => as(s, s.center, () => manage().createCourse(s.tenantId, s.center, body(s, over) as never))
    expect(await err(create({ price: 1_234_500 }))).toBe('course_price_invalid')
    expect(await err(create({ price: 40_000 }))).toBe('course_price_invalid')
    expect(await err(create({ price: 1_000_000, discount: live(51) }))).toBe('discount_over_limit')
    expect(await err(create({ price: 1_000_000, discount: live(90) }))).toBe('discount_over_limit')
    const ok = await create({ price: 1_234_000, discount: live(50) })
    expect(ok).toMatchObject({ price: 1_234_000, priceRule: 1, discount: { percent: 50 } })
    // Changing it later follows the same limit.
    expect(await err(as(s, s.center, () => manage().setCourseDiscount(s.tenantId, s.center, ok.id, live(60))))).toBe('discount_over_limit')
    expect(await err(as(s, s.center, () => manage().updateCourse(s.tenantId, s.center, ok.id, { discount: live(60) })))).toBe('discount_over_limit')
    expect(await err(create({ price: 0, discount: live(5) }))).toBe('free_course_no_discount')
    await expect(create({ price: 0, status: 'published' })).resolves.toMatchObject({ price: 0, status: 'published' })
  })

  it('the database holds the price of a new course too: whole thousands from 50 000 or 0 (migration 20261126000200)', async () => {
    const s = await setup('calc-db')
    const db = ctx.prisma.client
    const course = await as(s, s.center, () => manage().createCourse(s.tenantId, s.center, body(s) as never))
    const setPrice = (minor: bigint, rule = 1) =>
      db.$executeRawUnsafe('UPDATE "Course" SET "priceMinor" = $1, "priceRule" = $2 WHERE id = $3', minor, rule, course.id).then(() => 'ok', (e: Error) => (/Course_calculator_price_check/.test(e.message) ? 'refused' : e.message))
    expect(await setPrice(1_234_500_00n)).toBe('refused') // not whole thousands
    expect(await setPrice(40_000_00n)).toBe('refused') // below 50 000
    expect(await setPrice(50_000_00n)).toBe('ok')
    expect(await setPrice(0n)).toBe('ok') // free
    expect(await setPrice(1_234_500_00n, 0)).toBe('ok') // a course of the old rule keeps any price
  })

  it('a paid new course is published only with a student discount (5% or more) in force: started, permanent or time-limited', async () => {
    const s = await setup()
    const m = manage()
    expect(await err(as(s, s.center, () => m.createCourse(s.tenantId, s.center, body(s, { status: 'published' }) as never)))).toBe('student_discount_required')
    const draft = await as(s, s.center, () => m.createCourse(s.tenantId, s.center, body(s) as never))
    expect(await err(as(s, s.center, () => m.updateCourse(s.tenantId, s.center, draft.id, { status: 'published' })))).toBe('student_discount_required')
    // One that starts later does not count yet.
    const later = { percent: 10, startsAt: new Date(Date.now() + day).toISOString(), endsAt: null }
    expect(await err(as(s, s.center, () => m.updateCourse(s.tenantId, s.center, draft.id, { status: 'published', discount: later })))).toBe('student_discount_required')
    // The term is the center's choice (22.11): a time-limited discount publishes the course like a permanent one.
    await expect(as(s, s.center, () => m.updateCourse(s.tenantId, s.center, draft.id, { status: 'published', discount: windowed(10) }))).resolves.toMatchObject({ status: 'published', discount: { percent: 10, endsAt: expect.any(String) } })
    await expect(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, draft.id, live(5)))).resolves.toMatchObject({ status: 'published', discount: { percent: 5, endsAt: null } })
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
    // A discount set now follows the new range on any course; its term — permanent or time-limited — is the center's choice.
    expect(await err(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, s.t.course.id, windowed(91))))).toBe('discount_over_limit')
    // Its limit is still 100% − K, not the 50% of the equal halves (23.11).
    await expect(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, s.t.course.id, live(90)))).resolves.toMatchObject({ discount: { percent: 90, endsAt: null } })
    await expect(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, s.t.course.id, live(10)))).resolves.toMatchObject({ discount: { percent: 10, endsAt: null } })
    await expect(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, s.t.course.id, windowed(10)))).resolves.toMatchObject({ discount: { percent: 10, endsAt: expect.any(String) } })
  })

  it('after a time-limited discount (22.11): a paid new course keeps the minimum — in the catalog, at checkout and when edited', async () => {
    const s = await setup('calc-term')
    const db = ctx.prisma.client
    const m = manage()
    const course = await as(s, s.center, () => m.createCourse(s.tenantId, s.center, body(s, { price: 1_000_000, discount: windowed(20), status: 'published' }) as never))
    expect(course).toMatchObject({ discount: { percent: 20, endsAt: expect.any(String) } })
    const group = await TenantContext.forTenant(s.tenantId, () => db.group.create({ data: { tenantId: s.tenantId, courseId: course.id, name: 'T', days: [3], startTime: '10:00', endTime: '11:00', capacity: 5 } }))
    // During the term: the center's 20% for the student (a total of 40%): 800 000, ILMORA the same 200 000, the center 600 000.
    const during = await ctx.checkout(s.tenantId, (await ctx.makeStudent(s.tenantId)).id, null as never, [group.id])
    await expect(TenantContext.forTenant(s.tenantId, () => db.paymentLine.findFirstOrThrow({ where: { paymentId: during.payment.id } }))).resolves.toMatchObject({ amountMinor: 80_000_000n, discountPercent: 20, commissionPercent: 20, centerShareMinor: 60_000_000n, platformShareMinor: 20_000_000n })
    // The term ran out an hour ago.
    const ended = new Date(Date.now() - 3_600_000)
    await TenantContext.forTenant(s.tenantId, () => db.course.update({ where: { id: course.id }, data: { discountStartsAt: new Date(Date.now() - 11 * day), discountEndsAt: ended } }))
    // The center's list and the form: 5% from the end on, with no end of its own.
    const listed = await as(s, s.center, () => m.listCenterCourses(s.tenantId, s.center))
    expect(listed.courses.find((c) => c.id === course.id)).toMatchObject({ status: 'published', discount: { percent: 5, startsAt: ended.toISOString(), endsAt: null } })
    // Checkout: 1 000 000 at 5% + 5% → 950 000; ILMORA 50 000, the center 900 000.
    const after = await ctx.checkout(s.tenantId, (await ctx.makeStudent(s.tenantId)).id, null as never, [group.id])
    await expect(TenantContext.forTenant(s.tenantId, () => db.paymentLine.findFirstOrThrow({ where: { paymentId: after.payment.id } }))).resolves.toMatchObject({ listPriceMinor: 100_000_000n, amountMinor: 95_000_000n, discountPercent: 5, commissionPercent: 5, centerShareMinor: 90_000_000n, platformShareMinor: 5_000_000n })
    // The course still counts as discounted: its price can be changed while published, and a new term can be set.
    await expect(as(s, s.center, () => m.updateCourse(s.tenantId, s.center, course.id, { price: 1_200_000 }))).resolves.toMatchObject({ price: 1_200_000, status: 'published', discount: { percent: 5, endsAt: null } })
    await expect(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, course.id, windowed(30)))).resolves.toMatchObject({ discount: { percent: 30, endsAt: expect.any(String) } })
    // A course from before the calculator has nothing after its term, as always.
    await TenantContext.forTenant(s.tenantId, () => db.course.update({ where: { id: s.t.course.id }, data: { discountPercent: 20, discountStartsAt: new Date(Date.now() - 11 * day), discountEndsAt: ended } }))
    const again = await as(s, s.center, () => m.listCenterCourses(s.tenantId, s.center))
    expect(again.courses.find((c) => c.id === s.t.course.id)?.discount ?? null).toBeNull()
  })

  it('checkout: 1 234 000 at 7% + 7% → 1 147 000, ILMORA 87 000, the center 1 060 000; the payment keeps S, the commission and both shares; an older course keeps K and its rounding', async () => {
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
    expect(byCourse[course.id]).toMatchObject({ listPriceMinor: 123_400_000n, amountMinor: 114_700_000n, discountPercent: 7, commissionPercent: 7, centerShareMinor: 106_000_000n, platformShareMinor: 8_700_000n })
    expect(byCourse[s.t.course.id]).toMatchObject({ listPriceMinor: 5_000_000n, amountMinor: 4_650_000n, discountPercent: 7, commissionPercent: 10, centerShareMinor: 4_150_000n, platformShareMinor: 500_000n })
    expect(payment.amountMinor).toBe(114_700_000n + 4_650_000n)
  })

  it('equal halves: 500 000 at a total of 20% → 450 000 / 400 000 / 50 000; 1 000 000 at 5% + 5%; at 50% + 50% the center gets 0', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const paid = async (percent: number, price = 1_000_000) => {
      const c = await as(s, s.center, () => manage().createCourse(s.tenantId, s.center, body(s, { price, discount: live(percent), status: 'published' }) as never))
      const g = await TenantContext.forTenant(s.tenantId, () => db.group.create({ data: { tenantId: s.tenantId, courseId: c.id, name: `G${percent}`, days: [5], startTime: '10:00', endTime: '11:00', capacity: 5 } }))
      const student = await ctx.makeStudent(s.tenantId)
      const { payment } = await ctx.checkout(s.tenantId, student.id, null as never, [g.id])
      return TenantContext.forTenant(s.tenantId, () => db.paymentLine.findFirstOrThrow({ where: { paymentId: payment.id } }))
    }
    expect(await paid(10, 500_000)).toMatchObject({ amountMinor: 45_000_000n, discountPercent: 10, commissionPercent: 10, centerShareMinor: 40_000_000n, platformShareMinor: 5_000_000n })
    expect(await paid(5)).toMatchObject({ amountMinor: 95_000_000n, commissionPercent: 5, centerShareMinor: 90_000_000n, platformShareMinor: 5_000_000n })
    expect(await paid(50)).toMatchObject({ amountMinor: 50_000_000n, commissionPercent: 50, centerShareMinor: 0n, platformShareMinor: 50_000_000n })
  })

  it('the commission: only the Super Admin, 2–50%, audited; new payments of older courses use the new one, a payment made keeps its own; a new course splits in halves whatever K is', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const m = manage()
    expect(CommissionInput.safeParse({ commissionPercent: 1 }).success).toBe(false)
    expect(CommissionInput.safeParse({ commissionPercent: 51 }).success).toBe(false)
    expect(CommissionInput.safeParse({ commissionPercent: 15, extra: 1 }).success).toBe(false)
    expect(await err(as(s, s.center, () => m.setCommission(s.tenantId, s.center, 15)))).toBe('forbidden')
    // A new course (rule 1) and the course from before the calculator (t.course: rule 0, 50 000 so'm), both at 5%.
    const course = await as(s, s.center, () => m.createCourse(s.tenantId, s.center, body(s, { price: 1_000_000, discount: live(5), status: 'published' }) as never))
    const group = await TenantContext.forTenant(s.tenantId, () => db.group.create({ data: { tenantId: s.tenantId, courseId: course.id, name: 'K', days: [6], startTime: '10:00', endTime: '11:00', capacity: 5 } }))
    await as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, s.t.course.id, live(5)))
    const buy = async () => ctx.checkout(s.tenantId, (await ctx.makeStudent(s.tenantId)).id, s.t.pkg.id, [group.id, s.t.group.id])
    const before = await buy()
    await expect(as(s, s.owner, () => m.setCommission(s.tenantId, s.owner, 15))).resolves.toMatchObject({ commissionPercent: 15, minDiscountPercent: 5, maxDiscountPercent: 85 })
    const audit = await TenantContext.forTenant(s.tenantId, () => db.auditEvent.findFirstOrThrow({ where: { action: 'pricing.commission', entityId: s.tenantId } }))
    expect(audit).toMatchObject({ actorId: s.owner.id, before: { commissionPercent: 10 }, after: { commissionPercent: 15 } })
    const after = await buy()
    const line = (paymentId: string, courseId: string) => TenantContext.forTenant(s.tenantId, () => db.paymentLine.findFirstOrThrow({ where: { paymentId, courseId } }))
    // The older course: 50 000 at 5% → 47 500; K 10% → the center 42 500, then K 15% → 40 000.
    expect(await line(before.payment.id, s.t.course.id)).toMatchObject({ commissionPercent: 10, amountMinor: 4_750_000n, centerShareMinor: 4_250_000n, platformShareMinor: 500_000n })
    expect(await line(after.payment.id, s.t.course.id)).toMatchObject({ commissionPercent: 15, amountMinor: 4_750_000n, centerShareMinor: 4_000_000n, platformShareMinor: 750_000n })
    // The new course: 5% + 5% both times — 950 000, ILMORA 50 000, the center 900 000.
    for (const p of [before, after]) expect(await line(p.payment.id, course.id)).toMatchObject({ commissionPercent: 5, amountMinor: 95_000_000n, centerShareMinor: 90_000_000n, platformShareMinor: 5_000_000n })
    // The limit of the older course moved with K: 86% is refused now; the new course's stays 50%.
    expect(await err(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, s.t.course.id, live(86))))).toBe('discount_over_limit')
    expect(await err(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, course.id, live(51))))).toBe('discount_over_limit')
    await expect(as(s, s.center, () => m.setCourseDiscount(s.tenantId, s.center, course.id, live(50)))).resolves.toMatchObject({ discount: { percent: 50 } })
    // The center sees it in its course list, and cannot change it.
    expect((await as(s, s.center, () => m.listCenterCourses(s.tenantId, s.center))).pricing).toEqual({ commissionPercent: 15, minDiscountPercent: 5, maxDiscountPercent: 85, minPriceSom: 50_000 })
  })
})
