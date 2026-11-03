import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { finalPriceMinor, MAX_DISCOUNT_PERCENT } from '@ilmora/shared'
import { ROLES_KEY } from '../src/common/decorators'
import type { Env } from '../src/config/env'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import type { AuditService } from '../src/modules/audit/audit.service'
import { ManageController } from '../src/modules/manage/manage.controller'
import { CourseDiscountBody, CourseInput, CoursePatch } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

const WINDOW = { percent: 20, startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z' }

describe('discount input rules', () => {
  it('accepts a whole percent window, null (remove) or nothing (keep)', () => {
    expect(CoursePatch.safeParse({ discount: WINDOW }).success).toBe(true)
    expect(CoursePatch.safeParse({ discount: null }).success).toBe(true)
    expect(CoursePatch.safeParse({}).success).toBe(true)
  })

  it('rejects bad percents, bad dates, an end that is not after the start and unknown keys', () => {
    for (const percent of [0, -1, MAX_DISCOUNT_PERCENT + 1, 100, 12.5]) expect(CoursePatch.safeParse({ discount: { ...WINDOW, percent } }).success).toBe(false)
    expect(CoursePatch.safeParse({ discount: { ...WINDOW, startsAt: 'tomorrow' } }).success).toBe(false)
    expect(CoursePatch.safeParse({ discount: { ...WINDOW, endsAt: WINDOW.startsAt } }).success).toBe(false)
    expect(CoursePatch.safeParse({ discount: { ...WINDOW, endsAt: '2026-10-01T00:00:00.000Z' } }).success).toBe(false)
    expect(CoursePatch.safeParse({ discount: { ...WINDOW, extra: 1 } }).success).toBe(false)
    expect(CourseInput.shape.discount).toBeDefined()
  })
})

describe('who may set a discount (stubbed storage)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'c1', tenantId: 't', slug: 'c1', title: {}, categoryId: 'cat', centerId: 'center-a', teacherId: 'teacher-1', subjectId: null, summary: {}, description: {}, curriculum: [],
    level: 'BEGINNER', durationMonths: 3, priceMinor: 10_000_000n, discountPercent: null, discountStartsAt: null, discountEndsAt: null, currency: 'UZS', coverSeed: 1, imageUrl: null,
    meyosGrant: false, status: 'PUBLISHED', visibility: 'PUBLIC', audienceStudentIds: [], audienceGroupIds: [], featured: false, reviewRequested: false, updatedAt: new Date(),
    groups: [], ...over,
  })
  const withDiscount = { discountPercent: 20, discountStartsAt: new Date(WINDOW.startsAt), discountEndsAt: new Date(WINDOW.endsAt) }

  function setup(stored: Record<string, unknown> = {}) {
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => row({ ...stored, ...data }))
    const prisma = { client: { course: { findFirst: async () => row(stored), update } } }
    const service = new ManageService(
      prisma as unknown as PrismaService,
      { record: async () => undefined } as unknown as AuditService,
      {} as unknown as SessionsService,
      { get: async () => ({ permissions: { teacher: { editCourses: true, editPrices: false, publishDirectly: true } } }) } as unknown as SiteService,
      notificationsStub,
      {} as unknown as Env,
    )
    const run = (actor: RequestActor, discount: typeof WINDOW | null) => service.updateCourse('t', actor, 'c1', { discount })
    return { update, run }
  }

  const superAdmin: RequestActor = { id: 'u-admin', roles: ['PLATFORM_ADMIN'] }
  const ownCenter: RequestActor = { id: 'u-ca', roles: ['CENTER_ADMIN'], centerId: 'center-a' }
  const otherCenter: RequestActor = { id: 'u-cb', roles: ['CENTER_ADMIN'], centerId: 'center-b' }
  const teacher: RequestActor = { id: 'u-t', roles: ['TEACHER'], teacherProfileId: 'teacher-1' }
  const centerAdminTeachingElsewhere: RequestActor = { id: 'u-x', roles: ['CENTER_ADMIN', 'TEACHER'], centerId: 'center-b', teacherProfileId: 'teacher-1' }

  it('lets the Super Admin and the center admin of the course center set and remove a discount', async () => {
    for (const actor of [superAdmin, ownCenter]) {
      const set = setup()
      const out = await set.run(actor, WINDOW)
      expect(set.update.mock.calls[0][0].data).toMatchObject({ discountPercent: 20, discountStartsAt: new Date(WINDOW.startsAt), discountEndsAt: new Date(WINDOW.endsAt) })
      expect(out.price).toBe(100_000) // the list price is untouched

      const remove = setup(withDiscount)
      await remove.run(actor, null)
      expect(remove.update.mock.calls[0][0].data).toMatchObject({ discountPercent: null, discountStartsAt: null, discountEndsAt: null })
    }
  })

  it('refuses teachers and center admins of another center, even when they own the course', async () => {
    for (const actor of [teacher, otherCenter, centerAdminTeachingElsewhere]) {
      const { update, run } = setup()
      await expect(run(actor, WINDOW)).rejects.toMatchObject({ code: 'forbidden' })
      expect(update).not.toHaveBeenCalled()
    }
  })

  it('does not treat resending the stored discount as a change, so teachers can still edit their course', async () => {
    const { update, run } = setup(withDiscount)
    await expect(run(teacher, WINDOW)).resolves.toBeDefined()
    expect(update.mock.calls[0][0].data).not.toHaveProperty('discountPercent')
    const none = setup()
    await expect(none.run(teacher, null)).resolves.toBeDefined()
    expect(none.update.mock.calls[0][0].data).not.toHaveProperty('discountPercent')
  })
})

describe('center admin endpoints (stubbed storage)', () => {
  const makeRow = (over: Record<string, unknown> = {}) => ({
    id: 'c1', tenantId: 't', slug: 'c1', title: {}, categoryId: 'cat', centerId: 'center-a', teacherId: 'teacher-1', subjectId: null, summary: {}, description: {}, curriculum: [],
    level: 'BEGINNER', durationMonths: 3, priceMinor: 10_000_000n, discountPercent: null, discountStartsAt: null, discountEndsAt: null, currency: 'UZS', coverSeed: 1, imageUrl: null,
    meyosGrant: false, status: 'PUBLISHED', visibility: 'PUBLIC', audienceStudentIds: [], audienceGroupIds: [], featured: false, reviewRequested: false, updatedAt: new Date(),
    groups: [], ...over,
  })
  const stored = { discountPercent: 10, discountStartsAt: new Date(WINDOW.startsAt), discountEndsAt: new Date(WINDOW.endsAt) }

  function make(storedOver: Record<string, unknown> = {}, missing = false) {
    const course = makeRow(storedOver)
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => makeRow({ ...storedOver, ...data }))
    const findMany = vi.fn(async (_args: unknown) => [course])
    const record = vi.fn(async (_event: unknown) => undefined)
    const prisma = {
      client: {
        course: { findFirst: async () => (missing ? null : course), findMany, update },
        center: { findFirst: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: 'Center A' }) },
      },
    }
    const site = { get: async () => ({ permissions: { teacher: { editCourses: true, editPrices: false, publishDirectly: true } } }) }
    const service = new ManageService(prisma as unknown as PrismaService, { record } as unknown as AuditService, {} as unknown as SessionsService, site as unknown as SiteService, notificationsStub, {} as unknown as Env)
    return { service, update, findMany, record }
  }

  const superAdmin: RequestActor = { id: 'u-admin', roles: ['PLATFORM_ADMIN'] }
  const ownCenter: RequestActor = { id: 'u-ca', roles: ['CENTER_ADMIN'], centerId: 'center-a' }
  const otherCenter: RequestActor = { id: 'u-cb', roles: ['CENTER_ADMIN'], centerId: 'center-b' }
  const noCenter: RequestActor = { id: 'u-cn', roles: ['CENTER_ADMIN'], centerId: null }
  const teacher: RequestActor = { id: 'u-t', roles: ['TEACHER'], teacherProfileId: 'teacher-1' }

  it('lists only the courses whose own center is the admin center, and refuses an admin without a center', async () => {
    const { service, findMany } = make()
    const out = await service.listCenterCourses('t', ownCenter)
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: 't', centerId: 'center-a', deletedAt: null } })
    expect(out.center).toEqual({ id: 'center-a', name: 'Center A' })
    expect(out.courses.map((c) => c.id)).toEqual(['c1'])

    findMany.mockClear()
    await expect(service.listCenterCourses('t', noCenter)).rejects.toMatchObject({ code: 'forbidden' })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('lets the Super Admin and the center of the course set or remove a discount, and audits each change', async () => {
    for (const actor of [superAdmin, ownCenter]) {
      const set = make()
      await set.service.setCourseDiscount('t', actor, 'c1', WINDOW)
      expect(set.update.mock.calls[0][0].data).toMatchObject({ discountPercent: 20, updatedById: actor.id })
      expect(set.record.mock.calls[0][0]).toMatchObject({ action: 'course.discount', entityId: 'c1', before: { discount: null }, after: { discount: { percent: 20 } } })

      const remove = make(stored)
      await remove.service.setCourseDiscount('t', actor, 'c1', null)
      expect(remove.update.mock.calls[0][0].data).toMatchObject({ discountPercent: null, discountStartsAt: null, discountEndsAt: null })
      expect(remove.record.mock.calls[0][0]).toMatchObject({ before: { discount: { percent: 10 } }, after: { discount: null } })
    }
  })

  it('refuses teachers, center admins of another center and admins without a center; unknown courses are not found', async () => {
    for (const actor of [teacher, otherCenter, noCenter]) {
      const { service, update, record } = make()
      await expect(service.setCourseDiscount('t', actor, 'c1', WINDOW)).rejects.toMatchObject({ code: 'forbidden' })
      expect(update).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    }
    await expect(make({}, true).service.setCourseDiscount('t', ownCenter, 'nope', WINDOW)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('changes and audits nothing when the discount is resent unchanged', async () => {
    const { service, update, record } = make({ ...stored, discountPercent: 20 })
    await service.setCourseDiscount('t', ownCenter, 'c1', WINDOW)
    expect(update).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('validates the request body: a discount object or null, nothing else', () => {
    expect(CourseDiscountBody.safeParse({ discount: WINDOW }).success).toBe(true)
    expect(CourseDiscountBody.safeParse({ discount: null }).success).toBe(true)
    expect(CourseDiscountBody.safeParse({}).success).toBe(false)
    expect(CourseDiscountBody.safeParse({ discount: { ...WINDOW, percent: 21 } }).success).toBe(false)
    expect(CourseDiscountBody.safeParse({ discount: WINDOW, extra: 1 }).success).toBe(false)
  })

  it('only the Super Admin may move a course to another center; resending the same center is fine', async () => {
    const moved = make()
    await expect(moved.service.updateCourse('t', teacher, 'c1', { centerId: 'center-b' })).rejects.toMatchObject({ code: 'forbidden' })
    expect(moved.update).not.toHaveBeenCalled()

    const same = make()
    await expect(same.service.updateCourse('t', teacher, 'c1', { centerId: 'center-a' })).resolves.toBeDefined()
    expect(same.update.mock.calls[0][0].data).not.toHaveProperty('centerId')

    const admin = make()
    await admin.service.updateCourse('t', superAdmin, 'c1', { centerId: 'center-b' })
    expect(admin.update.mock.calls[0][0].data).toMatchObject({ centerId: 'center-b' })
  })

  it('on the manage controller, center admins reach exactly the two center endpoints and nothing of the Teacher Studio', () => {
    const classRoles = Reflect.getMetadata(ROLES_KEY, ManageController) as string[]
    expect(classRoles).not.toContain('CENTER_ADMIN')
    const proto = ManageController.prototype as unknown as Record<string, unknown>
    const reachable = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
      .filter((name) => ((Reflect.getMetadata(ROLES_KEY, proto[name] as object) as string[] | undefined) ?? classRoles).includes('CENTER_ADMIN'))
    expect(reachable.sort()).toEqual(['centerCourses', 'setCourseDiscount'])
  })
})

describe('admin user search (stubbed storage)', () => {
  function make() {
    const findMany = vi.fn(async (_args: unknown) => [] as never[])
    const prisma = { client: { user: { findMany, count: async () => 0 } } }
    const service = new ManageService(prisma as unknown as PrismaService, {} as unknown as AuditService, {} as unknown as SessionsService, {} as unknown as SiteService, notificationsStub, {} as unknown as Env)
    return { service, where: () => (findMany.mock.calls[0][0] as { where: { OR?: Record<string, unknown>[]; roles?: unknown } }).where }
  }

  it('searches name and login for text, and never adds a phone clause that would match everyone', async () => {
    const { service, where } = make()
    await service.listUsers('t', { search: 'Madina ' })
    expect(where().OR).toEqual([{ displayName: { contains: 'Madina', mode: 'insensitive' } }, { login: { contains: 'madina' } }])
  })

  it('adds the phone clause only when the search contains digits', async () => {
    const { service, where } = make()
    await service.listUsers('t', { search: '+998 90 123' })
    expect(where().OR).toContainEqual({ phoneE164: { contains: '99890123' } })
  })

  it('applies no search filter without a search, and keeps the role filter', async () => {
    const { service, where } = make()
    await service.listUsers('t', { role: 'CENTER_ADMIN', search: '  ' })
    expect(where().OR).toBeUndefined()
    expect(where().roles).toEqual({ has: 'CENTER_ADMIN' })
  })
})

describe.skipIf(!DB_AVAILABLE)('checkout charges the list price minus the discount active at that moment', () => {
  const ctx = new TestContext()

  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const setDiscount = (courseId: string, percent: number, startsAt: Date, endsAt: Date) =>
    TenantContext.system(() => ctx.prisma.client.course.update({ where: { id: courseId }, data: { discountPercent: percent, discountStartsAt: startsAt, discountEndsAt: endsAt } }))
  const day = 86_400_000
  const around = (fromDays: number, toDays: number) => [new Date(Date.now() + fromDays * day), new Date(Date.now() + toDays * day)] as const

  it('charges the discounted amount for an active discount and records list price and discount', async () => {
    const t = await ctx.makeTenant('disc')
    const student = await ctx.makeStudent(t.tenantId)
    await setDiscount(t.course.id, 20, ...around(-1, 1))
    const { subscription, payment } = await TenantContext.forTenant(t.tenantId, async () => {
      await ctx.subscriptions.saveDraft(t.tenantId, student.id, { packageId: null, groupIds: [t.group.id, t.group2.id], meyosGrant: false })
      return ctx.subscriptions.checkout(t.tenantId, student.id, 'PAYME')
    })
    const expected = finalPriceMinor(t.course.priceMinor, { percent: 20, startsAt: around(-1, 1)[0], endsAt: around(-1, 1)[1] }, new Date()) + t.course2.priceMinor
    expect(payment.amountMinor).toBe(expected)
    expect(subscription.amountMinor).toBe(expected)
    expect(payment.amountMinor).toBeLessThan(t.course.priceMinor + t.course2.priceMinor)
  })

  it('ignores a discount that has not started yet or has already ended', async () => {
    const t = await ctx.makeTenant('disc')
    const future = await ctx.makeStudent(t.tenantId)
    await setDiscount(t.course.id, 15, ...around(1, 2))
    const a = await TenantContext.forTenant(t.tenantId, async () => {
      await ctx.subscriptions.saveDraft(t.tenantId, future.id, { packageId: null, groupIds: [t.group.id], meyosGrant: false })
      return ctx.subscriptions.checkout(t.tenantId, future.id, 'PAYME')
    })
    expect(a.payment.amountMinor).toBe(t.course.priceMinor)

    const expired = await ctx.makeStudent(t.tenantId)
    await setDiscount(t.course.id, 15, ...around(-3, -1))
    const b = await TenantContext.forTenant(t.tenantId, async () => {
      await ctx.subscriptions.saveDraft(t.tenantId, expired.id, { packageId: null, groupIds: [t.group.id], meyosGrant: false })
      return ctx.subscriptions.checkout(t.tenantId, expired.id, 'PAYME')
    })
    expect(b.payment.amountMinor).toBe(t.course.priceMinor)
  })

  it('lists a center\'s courses by the course\'s own center, even when its teacher belongs to another center', async () => {
    const t = await ctx.makeTenant('disc')
    const other = await TenantContext.system(() => ctx.prisma.client.center.create({ data: { tenantId: t.tenantId, slug: `other-${t.tenantId}`, name: 'Other', district: {}, description: {} } }))
    await TenantContext.system(() => ctx.prisma.client.course.update({ where: { id: t.course2.id }, data: { centerId: other.id } }))
    const service = new ManageService(ctx.prisma, ctx.audit, {} as unknown as SessionsService, {} as unknown as SiteService, notificationsStub, ctx.env)
    const mine = await TenantContext.forTenant(t.tenantId, () => service.listCenterCourses(t.tenantId, { id: 'u', roles: ['CENTER_ADMIN'], centerId: t.center.id }))
    expect(mine.courses.map((c) => c.id)).toEqual([t.course.id])
  })
})
