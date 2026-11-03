import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ONLINE_COURSES } from '@ilmora/shared'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import { toCourse } from '../src/modules/catalog/catalog.service'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

const L = (s: string) => ({ uz: s, ru: s, en: s })
const admin: RequestActor = { id: 'u-admin', roles: ['PLATFORM_ADMIN'] }

describe.skipIf(!DB_AVAILABLE)('online courses against PostgreSQL', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const manage = () =>
    new ManageService(
      ctx.prisma,
      ctx.audit,
      { generateForGroup: async () => 0, todayLocal: () => '2026-10-31' } as unknown as SessionsService,
      { get: async () => ({ permissions: { teacher: { editCourses: true, editPrices: true, publishDirectly: true, manageGroups: true, editSchedules: true } } }) } as unknown as SiteService,
      notificationsStub,
      ctx.env,
    )
  const sample = ONLINE_COURSES[0]
  const body = (categoryId: string, title: string) => ({
    title: L(title), categoryId, summary: sample.summary, description: sample.description, curriculum: sample.curriculum.map(L), level: sample.level, durationMonths: 1, price: 0,
    learningFormat: 'ONLINE' as const, externalUrl: sample.url, providerName: sample.provider, instructorName: sample.instructor, certificate: sample.certificate, durationText: sample.durationText,
  })

  it('courses created before the column existed (and any default course) are OFFLINE with no online fields', async () => {
    const t = await ctx.makeTenant('onl')
    const row = await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.course.findFirstOrThrow({ where: { id: t.course.id }, include: { groups: true } }))
    expect(row.learningFormat).toBe('OFFLINE')
    expect(row.externalUrl).toBeNull()
    expect(row.certificate).toBe('NONE')
    expect(toCourse(row)).toMatchObject({ learningFormat: 'OFFLINE' })
  })

  it('creates a free ONLINE course on a shared platform center and profile, stores the link and certificate, and returns them', async () => {
    const t = await ctx.makeTenant('onl')
    const [first, second] = await TenantContext.forTenant(t.tenantId, async () => [
      await manage().createCourse(t.tenantId, admin, body(t.category.id, 'First online')),
      await manage().createCourse(t.tenantId, admin, body(t.category.id, 'Second online')),
    ])
    expect(first).toMatchObject({ learningFormat: 'ONLINE', price: 0, externalUrl: sample.url, providerName: sample.provider, instructorName: sample.instructor, certificate: sample.certificate, groups: [] })
    expect(first.centerId).toBe(second.centerId)
    expect(first.teacherId).toBe(second.teacherId)
    const centers = await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.center.findMany({ where: { tenantId: t.tenantId, slug: 'ilmora-online' } }))
    expect(centers).toHaveLength(1)
    // the platform profile is login-less and hidden from the teacher directory
    const profile = await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.teacherProfile.findFirstOrThrow({ where: { id: first.teacherId } }))
    expect(profile.userId).toBeNull()
    expect(profile.channelActive).toBe(false)
  })

  it('an online course cannot receive groups, so it can never be put in a subscription', async () => {
    const t = await ctx.makeTenant('onl')
    const online = await TenantContext.forTenant(t.tenantId, () => manage().createCourse(t.tenantId, admin, body(t.category.id, 'No groups')))
    await expect(TenantContext.forTenant(t.tenantId, () => manage().createGroup(t.tenantId, admin, online.id, { name: 'A', days: [0], start: '10:00', end: '11:00', room: '1', capacity: 5 }))).rejects.toThrow(/no groups/)
    const student = await ctx.makeStudent(t.tenantId)
    // a draft that points at a group which does not belong to any published offline course is refused
    await expect(TenantContext.forTenant(t.tenantId, () => ctx.subscriptions.saveDraft(t.tenantId, student.id, { packageId: null, groupIds: ['not-a-group'], meyosGrant: false }))).rejects.toThrow()
  })

  it('a course that has groups cannot be switched to online', async () => {
    const t = await ctx.makeTenant('onl')
    await expect(
      TenantContext.forTenant(t.tenantId, () => manage().updateCourse(t.tenantId, admin, t.course.id, { learningFormat: 'ONLINE', externalUrl: sample.url, providerName: sample.provider })),
    ).rejects.toThrow(/groups/)
  })
})
