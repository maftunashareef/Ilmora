import { DEFAULT_COURSE_PRICE_SOM } from '@ilmora/shared'
import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/config/env'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import type { RequestActor } from '../src/infra/tenancy/tenant-context'
import type { AuditService } from '../src/modules/audit/audit.service'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { notificationsStub } from './stubs'

const L = (s: string) => ({ uz: s, ru: s, en: s })
type CreateBody = Parameters<ManageService['createCourse']>[2]
const body = (centerId: string, price = 1): CreateBody => ({
  title: L('Algebra'), categoryId: 'cat', summary: L('s'), description: L('d'), curriculum: [], centerId, level: 'beginner', durationMonths: 3, price, coverSeed: 1,
  learningFormat: 'OFFLINE', status: 'draft', visibility: 'public', audience: { studentIds: [], groupIds: [] },
} as unknown as CreateBody)

const teacher: RequestActor = { id: 'u-teacher', roles: ['TEACHER'], centerId: null, teacherProfileId: 'teacher-1' }
const centerAdminA: RequestActor = { id: 'u-center-a', roles: ['CENTER_ADMIN'], centerId: 'center-a', teacherProfileId: null }
const superAdmin: RequestActor = { id: 'u-owner', roles: ['PLATFORM_ADMIN'], centerId: null, teacherProfileId: null }

const row = (data: Record<string, unknown>) => ({
  id: 'c1', tenantId: 't', slug: 'algebra', title: L('Algebra'), categoryId: 'cat', centerId: 'center-b', teacherId: 'teacher-1', subjectId: null, summary: L('s'), description: L('d'), curriculum: [],
  level: 'BEGINNER', durationMonths: 3, priceMinor: 100n, discountPercent: null, discountStartsAt: null, discountEndsAt: null, currency: 'UZS', coverSeed: 1, imageUrl: null,
  meyosGrant: false, status: 'DRAFT', visibility: 'PUBLIC', audienceStudentIds: [], audienceGroupIds: [], featured: false, reviewRequested: false, updatedAt: new Date(),
  learningFormat: 'OFFLINE', externalUrl: null, providerName: null, instructorName: null, certificate: 'NONE', durationText: null, groups: [], ...data,
})

function setup(opts: { profileCenter: string | null; editPrices?: boolean; groups?: { id: string }[]; linkedAccounts?: number }) {
  const created: Record<string, unknown>[] = []
  const calls: Record<string, unknown[]> = {}
  const spy = (name: string, result: unknown) => vi.fn(async (args: unknown) => { (calls[name] ??= []).push(args); return result })
  const prisma = {
    client: {
      course: {
        findFirst: vi.fn(async (args: { where: { id?: string } }) => (args.where.id ? row({ groups: opts.groups ?? [] }) : null)),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return row(data) }),
        update: spy('course.update', row({})),
        count: spy('course.count', 0),
      },
      center: { findFirst: vi.fn(async () => ({ id: 'center-b', status: 'ACTIVE', deletedAt: null })), update: spy('center.update', {}) },
      teacherProfile: { findFirst: vi.fn(async () => ({ id: 'teacher-1', centerId: opts.profileCenter })), count: spy('teacherProfile.count', 0) },
      user: { count: spy('user.count', opts.linkedAccounts ?? 0) },
      group: { count: vi.fn(async () => 0), updateMany: spy('group.updateMany', { count: 1 }) },
      enrollment: { count: vi.fn(async () => 0) },
      lessonSession: { updateMany: spy('lessonSession.updateMany', { count: 2 }) },
    },
  }
  const service = new ManageService(
    prisma as unknown as PrismaService,
    { record: async () => undefined } as unknown as AuditService,
    { generateForGroup: async () => 0, todayLocal: () => '2026-11-06' } as unknown as SessionsService,
    { get: async () => ({ permissions: { teacher: { editCourses: true, editPrices: opts.editPrices ?? false, publishDirectly: false, manageGroups: true, editSchedules: true } } }) } as unknown as SiteService,
    notificationsStub,
    {} as unknown as Env,
  )
  return { service, created, calls }
}

describe('course creation stays inside the author’s center', () => {
  it('refuses a teacher who names another center, and one whose profile has no center yet', async () => {
    const other = setup({ profileCenter: 'center-a' })
    await expect(other.service.createCourse('t', teacher, body('center-b'))).rejects.toMatchObject({ details: { code: 'wrong_center' } })
    const unlinked = setup({ profileCenter: null })
    await expect(unlinked.service.createCourse('t', teacher, body('center-b'))).rejects.toMatchObject({ details: { code: 'teacher_center_required' } })
    expect(other.created).toHaveLength(0)
    expect(unlinked.created).toHaveLength(0)
  })

  it('refuses a center administrator who names another center', async () => {
    const { service, created } = setup({ profileCenter: 'center-b' })
    // Refused either as the wrong center or as a teacher outside the center: both keep the course out.
    await expect(service.createCourse('t', centerAdminA, { ...body('center-b'), teacherId: 'teacher-1' })).rejects.toThrow(/center/)
    expect(created).toHaveLength(0)
  })

  it('stores the default price for a teacher without the price switch, and the given price otherwise', async () => {
    const locked = setup({ profileCenter: 'center-b', editPrices: false })
    await locked.service.createCourse('t', teacher, body('center-b', 1))
    expect(locked.created[0]).toMatchObject({ centerId: 'center-b', priceMinor: BigInt(DEFAULT_COURSE_PRICE_SOM) * 100n })

    const free = setup({ profileCenter: 'center-b', editPrices: true })
    await free.service.createCourse('t', teacher, body('center-b', 250_000))
    expect(free.created[0]).toMatchObject({ priceMinor: 25_000_000n })

    const admin = setup({ profileCenter: null })
    await admin.service.createCourse('t', superAdmin, { ...body('center-b', 1), teacherId: 'teacher-1' })
    expect(admin.created[0]).toMatchObject({ priceMinor: 100n })
  })
})

describe('deleting a course or a center leaves nothing live behind', () => {
  it('archives the course, soft-deletes its groups and cancels their scheduled lessons', async () => {
    const { service, calls } = setup({ profileCenter: 'center-b', groups: [{ id: 'g1' }, { id: 'g2' }] })
    await service.deleteCourse('t', superAdmin, 'c1')
    expect(calls['course.update']?.[0]).toMatchObject({ data: { status: 'ARCHIVED' } })
    expect(calls['group.updateMany']?.[0]).toMatchObject({ where: { id: { in: ['g1', 'g2'] } } })
    expect(calls['lessonSession.updateMany']?.[0]).toMatchObject({ where: { groupId: { in: ['g1', 'g2'] }, status: 'SCHEDULED' }, data: { status: 'CANCELLED', attendanceOpen: false } })
  })

  it('refuses to delete a center that still has linked accounts', async () => {
    const { service, calls } = setup({ profileCenter: null, linkedAccounts: 1 })
    await expect(service.deleteCenter('t', 'center-b')).rejects.toMatchObject({ code: 'in_use' })
    expect(calls['center.update']).toBeUndefined()
  })
})

describe('content is created for a center’s own teachers only', () => {
  const video = { title: L('v'), description: L('d'), source: { kind: 'link', url: 'https://www.youtube.com/watch?v=abc' }, durationSec: 0 } as unknown as Parameters<ManageService['createVideo']>[2]

  it('refuses a center administrator who names a teacher of another center, or no teacher at all', async () => {
    const foreign = setup({ profileCenter: 'center-b' })
    await expect(foreign.service.createVideo('t', centerAdminA, { ...video, teacherId: 'teacher-1' })).rejects.toMatchObject({ details: { code: 'teacher_not_in_center' } })
    const nobody = setup({ profileCenter: 'center-a' })
    await expect(nobody.service.createVideo('t', centerAdminA, video)).rejects.toMatchObject({ code: 'teacher_required' })
  })
})
