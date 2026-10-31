import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/config/env'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import type { RequestActor } from '../src/infra/tenancy/tenant-context'
import type { AuditService } from '../src/modules/audit/audit.service'
import { toCourse } from '../src/modules/catalog/catalog.service'
import { CourseInput, CoursePatch } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'

const L = (s: string) => ({ uz: s, ru: s, en: s })
const ONLINE_BODY = {
  title: L('CS50P'), categoryId: 'cat-python', summary: L('s'), description: L('d'), curriculum: [L('Functions')], level: 'beginner' as const, durationMonths: 1, price: 0,
  learningFormat: 'ONLINE' as const, externalUrl: 'https://cs50.harvard.edu/python/', providerName: 'Harvard CS50', instructorName: 'David J. Malan', certificate: 'AVAILABLE' as const,
  durationText: { uz: '10 hafta', ru: '10 недель', en: '10 weeks' },
}
const OFFLINE_BODY = { title: L('Algebra'), categoryId: 'cat-math', centerId: 'center-a', teacherId: 'teacher-1', summary: L('s'), description: L('d'), curriculum: [], level: 'beginner' as const, durationMonths: 3, price: 500_000 }

const superAdmin: RequestActor = { id: 'u-admin', roles: ['PLATFORM_ADMIN'] }
const teacher: RequestActor = { id: 'u-t', roles: ['TEACHER'], teacherProfileId: 'teacher-1' }
const centerAdmin: RequestActor = { id: 'u-ca', roles: ['CENTER_ADMIN'], centerId: 'center-a' }

describe('online course input', () => {
  it('accepts an online course without a center or teacher, and an offline body as before', () => {
    expect(CourseInput.safeParse(ONLINE_BODY).success).toBe(true)
    expect(CourseInput.safeParse(OFFLINE_BODY).success).toBe(true)
    expect(CoursePatch.safeParse({ learningFormat: 'ONLINE' }).success).toBe(true)
  })

  it('allows only plain https links, known formats and certificate kinds', () => {
    for (const externalUrl of ['http://cs50.harvard.edu/python/', 'javascript:alert(1)', 'ftp://x.org/a', 'https://user:pw@example.org/a', 'https://localhost/a', 'cs50.harvard.edu', '']) {
      expect(CourseInput.safeParse({ ...ONLINE_BODY, externalUrl }).success, externalUrl).toBe(false)
    }
    expect(CourseInput.safeParse({ ...ONLINE_BODY, learningFormat: 'HYBRID' }).success).toBe(false)
    expect(CourseInput.safeParse({ ...ONLINE_BODY, certificate: 'MAYBE' }).success).toBe(false)
    expect(CourseInput.safeParse({ ...ONLINE_BODY, unexpected: 1 }).success).toBe(false)
  })
})

describe('online courses (stubbed storage)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'c1', tenantId: 't', slug: 'c1', title: L('x'), categoryId: 'cat', centerId: 'center-a', teacherId: 'teacher-1', subjectId: null, summary: L('s'), description: L('d'), curriculum: [],
    level: 'BEGINNER', durationMonths: 3, priceMinor: 50_000_000n, discountPercent: null, discountStartsAt: null, discountEndsAt: null, currency: 'UZS', coverSeed: 1, imageUrl: null,
    meyosGrant: false, status: 'PUBLISHED', visibility: 'PUBLIC', audienceStudentIds: [], audienceGroupIds: [], featured: false, reviewRequested: false, updatedAt: new Date(),
    learningFormat: 'OFFLINE', externalUrl: null, providerName: null, instructorName: null, certificate: 'NONE', durationText: null, groups: [], ...over,
  })

  function setup(stored: Record<string, unknown> = {}, groupCount = 0) {
    const created: Record<string, unknown>[] = []
    const updated: Record<string, unknown>[] = []
    const centers: { id: string; deletedAt: null }[] = []
    const profiles: { id: string; deletedAt: null }[] = []
    const prisma = {
      client: {
        course: {
          findFirst: vi.fn(async (args: { where: { id?: string } }) => (args.where.id ? row(stored) : null)),
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return row({ ...data, groups: [] }) }),
          update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { updated.push(data); return row({ ...stored, ...data }) }),
        },
        center: {
          findFirst: vi.fn(async () => centers[0] ?? null),
          create: vi.fn(async () => { const c = { id: 'center-online', deletedAt: null as null }; centers.push(c); return c }),
        },
        teacherProfile: {
          findFirst: vi.fn(async () => profiles[0] ?? null),
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push({ profile: data }); const p = { id: 'teacher-online', deletedAt: null as null }; profiles.push(p); return p }),
        },
        group: { count: vi.fn(async () => groupCount), create: vi.fn() },
      },
    }
    const service = new ManageService(
      prisma as unknown as PrismaService,
      { record: async () => undefined } as unknown as AuditService,
      { generateForGroup: async () => 0, todayLocal: () => '2026-10-31' } as unknown as SessionsService,
      { get: async () => ({ permissions: { teacher: { editCourses: true, editPrices: true, publishDirectly: true, manageGroups: true, editSchedules: true } } }) } as unknown as SiteService,
      {} as unknown as Env,
    )
    return { service, prisma, created, updated }
  }

  it('only the Super Admin can create an online course; it lands on the platform center and profile as a free course', async () => {
    const { service, created } = setup()
    await expect(service.createCourse('t', teacher, ONLINE_BODY)).rejects.toThrow(/Super Admin/)
    await expect(service.createCourse('t', centerAdmin, ONLINE_BODY)).rejects.toThrow(/Super Admin/)
    expect(created).toHaveLength(0)

    const dto = await service.createCourse('t', superAdmin, ONLINE_BODY)
    const course = created.find((c) => !('profile' in c)) as Record<string, unknown>
    expect(course).toMatchObject({ learningFormat: 'ONLINE', centerId: 'center-online', teacherId: 'teacher-online', externalUrl: 'https://cs50.harvard.edu/python/', providerName: 'Harvard CS50', instructorName: 'David J. Malan', certificate: 'AVAILABLE', priceMinor: 0n })
    expect(dto).toMatchObject({ learningFormat: 'ONLINE', externalUrl: 'https://cs50.harvard.edu/python/', providerName: 'Harvard CS50', certificate: 'AVAILABLE', price: 0 })
  })

  it('creates the platform center and profile once and reuses them', async () => {
    const { service, prisma } = setup()
    await service.createCourse('t', superAdmin, ONLINE_BODY)
    await service.createCourse('t', superAdmin, { ...ONLINE_BODY, title: L('Another') })
    expect(prisma.client.center.create).toHaveBeenCalledTimes(1)
    expect(prisma.client.teacherProfile.create).toHaveBeenCalledTimes(1)
  })

  it('an online course needs a link and a provider, must be free, and cannot have a discount', async () => {
    const { service, created } = setup()
    await expect(service.createCourse('t', superAdmin, { ...ONLINE_BODY, externalUrl: null })).rejects.toThrow(/https link/)
    await expect(service.createCourse('t', superAdmin, { ...ONLINE_BODY, externalUrl: undefined })).rejects.toThrow(/https link/)
    await expect(service.createCourse('t', superAdmin, { ...ONLINE_BODY, providerName: ' ' })).rejects.toThrow()
    await expect(service.createCourse('t', superAdmin, { ...ONLINE_BODY, providerName: null })).rejects.toThrow(/provider/)
    await expect(service.createCourse('t', superAdmin, { ...ONLINE_BODY, price: 100_000 })).rejects.toThrow(/free/)
    await expect(service.createCourse('t', superAdmin, { ...ONLINE_BODY, discount: { percent: 10, startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z' } })).rejects.toThrow(/discount/)
    expect(created).toHaveLength(0)
  })

  it('an offline course still needs a center and teacher, and cannot carry online-only fields', async () => {
    const { service, created } = setup()
    await expect(service.createCourse('t', superAdmin, { ...OFFLINE_BODY, centerId: undefined })).rejects.toThrow(/centerId/)
    await expect(service.createCourse('t', superAdmin, { ...OFFLINE_BODY, externalUrl: 'https://example.org/x' })).rejects.toThrow(/online course/)
    await expect(service.createCourse('t', teacher, { ...OFFLINE_BODY, providerName: 'Someone' })).rejects.toThrow(/online course/)
    await service.createCourse('t', teacher, OFFLINE_BODY)
    expect(created[0]).toMatchObject({ learningFormat: 'OFFLINE', centerId: 'center-a', teacherId: 'teacher-1', priceMinor: 50_000_000n })
  })

  it('teachers cannot switch a course to online, send online fields, or edit an online course', async () => {
    const { service, updated } = setup()
    await expect(service.updateCourse('t', teacher, 'c1', { learningFormat: 'ONLINE' })).rejects.toThrow(/Super Admin/)
    await expect(service.updateCourse('t', teacher, 'c1', { externalUrl: 'https://example.org/x' })).rejects.toThrow(/Super Admin/)
    const online = setup({ learningFormat: 'ONLINE', externalUrl: 'https://example.org/x', providerName: 'P', teacherId: 'teacher-online', centerId: 'center-online' })
    await expect(online.service.updateCourse('t', teacher, 'c1', { title: L('hack') })).rejects.toThrow()
    expect(updated).toHaveLength(0)
    expect(online.updated).toHaveLength(0)
    // a teacher resending the unchanged format and empty online fields is an ordinary offline edit
    await service.updateCourse('t', teacher, 'c1', { learningFormat: 'OFFLINE', certificate: 'NONE', externalUrl: null, title: L('ok') })
    expect(updated).toHaveLength(1)
  })

  it('switching an offline course to online needs no groups, a link and a provider; it becomes free and loses any discount', async () => {
    const withGroups = setup({}, 2)
    await expect(withGroups.service.updateCourse('t', superAdmin, 'c1', { learningFormat: 'ONLINE', externalUrl: 'https://example.org/x', providerName: 'P' })).rejects.toThrow(/groups/)

    const { service, updated } = setup({ discountPercent: 10, discountStartsAt: new Date(), discountEndsAt: new Date(Date.now() + 86_400_000) })
    await expect(service.updateCourse('t', superAdmin, 'c1', { learningFormat: 'ONLINE' })).rejects.toThrow(/https link/)
    await service.updateCourse('t', superAdmin, 'c1', { learningFormat: 'ONLINE', externalUrl: 'https://example.org/x', providerName: 'P' })
    expect(updated[0]).toMatchObject({ learningFormat: 'ONLINE', centerId: 'center-online', teacherId: 'teacher-online', priceMinor: 0n, discountPercent: null, discountStartsAt: null, discountEndsAt: null })
  })

  it('switching an online course back to offline needs a center and a teacher and clears the online fields', async () => {
    const stored = { learningFormat: 'ONLINE', externalUrl: 'https://example.org/x', providerName: 'P', certificate: 'FREE', priceMinor: 0n, centerId: 'center-online', teacherId: 'teacher-online' }
    const { service, updated } = setup(stored)
    await expect(service.updateCourse('t', superAdmin, 'c1', { learningFormat: 'OFFLINE' })).rejects.toThrow(/center/i)
    await service.updateCourse('t', superAdmin, 'c1', { learningFormat: 'OFFLINE', centerId: 'center-a', teacherId: 'teacher-1', price: 400_000 })
    expect(updated[0]).toMatchObject({ learningFormat: 'OFFLINE', centerId: 'center-a', teacherId: 'teacher-1', externalUrl: null, providerName: null, instructorName: null, certificate: 'NONE', priceMinor: 40_000_000n })
  })

  it('an online course stays free: a price or discount is refused, a new link must still be https', async () => {
    const stored = { learningFormat: 'ONLINE', externalUrl: 'https://example.org/x', providerName: 'P', priceMinor: 0n, centerId: 'center-online', teacherId: 'teacher-online' }
    const { service, updated } = setup(stored)
    await expect(service.updateCourse('t', superAdmin, 'c1', { price: 100_000 })).rejects.toThrow(/free/)
    await expect(service.updateCourse('t', superAdmin, 'c1', { externalUrl: 'http://example.org/x' } as never)).rejects.toThrow(/https/)
    await expect(service.setCourseDiscount('t', superAdmin, 'c1', { percent: 10, startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z' })).rejects.toThrow(/discount/)
    await service.updateCourse('t', superAdmin, 'c1', { providerName: 'Harvard', certificate: 'PAID' })
    expect(updated[0]).toMatchObject({ providerName: 'Harvard', certificate: 'PAID', externalUrl: 'https://example.org/x', priceMinor: 0n })
  })

  it('online courses cannot get groups', async () => {
    const { service, prisma } = setup({ learningFormat: 'ONLINE', externalUrl: 'https://example.org/x', providerName: 'P', teacherId: 'teacher-online', centerId: 'center-online' })
    await expect(service.createGroup('t', superAdmin, 'c1', { name: 'A', days: [0], start: '10:00', end: '11:00', room: '1', capacity: 5 })).rejects.toThrow(/no groups/)
    expect(prisma.client.group.create).not.toHaveBeenCalled()
  })

  it('the public course only carries the link, provider and certificate when it is online', () => {
    const online = toCourse(row({ learningFormat: 'ONLINE', externalUrl: 'https://example.org/x', providerName: 'P', instructorName: 'I', certificate: 'FREE', durationText: L('9 weeks') }))
    expect(online).toMatchObject({ learningFormat: 'ONLINE', externalUrl: 'https://example.org/x', providerName: 'P', instructorName: 'I', certificate: 'FREE', durationText: L('9 weeks') })
    const offline = toCourse(row({ externalUrl: 'https://leftover.example', providerName: 'stale' }))
    expect(offline.learningFormat).toBe('OFFLINE')
    expect(offline).not.toHaveProperty('externalUrl')
    expect(offline).not.toHaveProperty('providerName')
    // an empty duration is not sent (the key is absent once serialised)
    expect(JSON.parse(JSON.stringify(toCourse(row({ learningFormat: 'ONLINE', externalUrl: 'https://example.org/x', providerName: 'P', durationText: L('') }))))).not.toHaveProperty('durationText')
  })
})
