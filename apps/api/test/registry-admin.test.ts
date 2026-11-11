import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registrySearchKey, registrySearchText } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { RegistryAdminController } from '../src/modules/registry/registry-admin.controller'
import { DirectionPatch, IndustryInput, IndustryPatch } from '../src/modules/registry/registry-admin.schemas'
import { RegistryAdminService } from '../src/modules/registry/registry-admin.service'
import { RegistryService } from '../src/modules/registry/registry.service'
import { DB_AVAILABLE, TestContext } from './helpers'

const Y = new Date().getUTCFullYear()

describe('Reference data for the Super Admin: access and input', () => {
  it('the Super Admin only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RegistryAdminController)).toEqual(['PLATFORM_ADMIN'])
  })
  it('a slug, names in three languages without markup; no foreign fields', () => {
    const ind = new ZodValidationPipe(IndustryInput)
    expect(ind.transform({ slug: 'green-energy', name: { uz: 'Yaşil energiya', ru: 'Зелёная энергетика', en: 'Green energy' } })).toMatchObject({ slug: 'green-energy' })
    for (const bad of [{ slug: 'Green Energy' }, { slug: 'x/../y' }, { name: { uz: '<b>x</b>', ru: 'Ок', en: 'Ok' } }, { id: 'x' }]) {
      expect(() => ind.transform({ slug: 'green-energy', name: { uz: 'Yaşil', ru: 'Зелёная', en: 'Green' }, ...bad })).toThrow()
    }
    expect(() => new ZodValidationPipe(IndustryPatch).transform({ slug: 'other' })).toThrow()
    expect(() => new ZodValidationPipe(DirectionPatch).transform({ mergedIntoId: 'x' })).toThrow()
  })
})

describe.skipIf(!DB_AVAILABLE)('Reference data for the Super Admin (ТЗ 9.2)', () => {
  const ctx = new TestContext()
  const service = new RegistryAdminService(ctx.prisma, ctx.audit)
  const registry = new RegistryService(ctx.prisma, ctx.audit)
  const sa = { id: 'sa', roles: ['PLATFORM_ADMIN'] } as RequestActor
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const tenantId = t.tenantId
    await TenantContext.system(() => seedRegistryReference(db as never, tenantId))
    return TenantContext.forTenant(tenantId, async () => {
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const furniture = await db.industry.findFirstOrThrow({ where: { slug: 'furniture' } })
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const dir = (name: string, industryId = it.id) => db.direction.create({ data: { tenantId, name, searchKey: registrySearchKey(name), industryId } })
      const inst = (name: string, source: 'IMPORT' | 'STUDENT', approved = false) =>
        db.institution.create({ data: { tenantId, type: 'TECHNIKUM', name, searchKey: registrySearchKey(name), searchText: registrySearchText(name), regionId: tashkent.id, source, status: approved ? 'APPROVED' : 'UNCLAIMED', approvedAt: approved ? new Date() : null } })
      const company = await db.company.create({ data: { tenantId, stir: '401111111', name: 'Soft Co', searchKey: registrySearchKey('Soft Co'), status: 'APPROVED', approvedAt: new Date(), regionId: tashkent.id } })
      const student = async (data: object) => {
        const u = await ctx.makeStudent(tenantId)
        await db.studentProfile.create({ data: { tenantId, userId: u.id, mode: 'STUDYING', ...data } })
        return u
      }
      return { tenantId, it, furniture, tashkent, dir, inst, company, student, inT: <T>(fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn) }
    })
  }

  it('industries: list with counts, add (slug unique), rename, hide from the public list', async () => {
    const s = await setup('ra-ind')
    await s.inT(async () => {
      await s.dir('Dasturlaş')
      const list = await service.industries()
      expect(list.find((i) => i.slug === 'it')).toMatchObject({ isActive: true, directions: 1, companies: 0 })
      const added = await service.createIndustry(s.tenantId, { slug: 'green-energy', name: { uz: 'Yaşil energiya', ru: 'Зелёная энергетика', en: 'Green energy' } })
      expect(added.at(-1)).toMatchObject({ slug: 'green-energy', name: { ru: 'Зелёная энергетика' } })
      await expect(service.createIndustry(s.tenantId, { slug: 'green-energy', name: { uz: 'Yaşil', ru: 'Зелёная', en: 'Green' } })).rejects.toMatchObject({ code: 'industry_exists' })
      const green = added.at(-1)!
      await service.updateIndustry(green.id, { name: { uz: 'Yaşil energetika', ru: 'Зелёная энергетика', en: 'Green energy' }, isActive: false })
      expect((await registry.industries()).map((i) => i.slug)).not.toContain('green-energy')
      await expect(service.updateIndustry('nope', { isActive: true })).rejects.toMatchObject({ code: 'not_found' })
      expect(await ctx.prisma.client.auditEvent.count({ where: { action: { in: ['registry.industry.create', 'registry.industry.update'] }, entityId: green.id } })).toBe(2)
    })
  })

  it('a direction: rename (the old name may not collide), move to another industry; an alias is changed through its main one', async () => {
    const s = await setup('ra-dir')
    await s.inT(async () => {
      const main = await s.dir('Dasturlaş')
      const typo = await s.dir('Dasturlas IT')
      await expect(service.updateDirection(sa, typo.id, { name: 'Dasturlaş' })).rejects.toMatchObject({ code: 'direction_exists', details: { id: main.id } })
      const renamed = await service.updateDirection(sa, typo.id, { name: 'Mebel dizayni', industryId: s.furniture.id, code: '5320' })
      expect(renamed).toMatchObject({ name: 'Mebel dizayni', industry: { slug: 'furniture' }, origin: 'ADMIN', code: '5320' })
      expect((await registry.suggestDirections({ q: 'mebel diz' })).map((d) => d.id)).toEqual([typo.id])
      await expect(service.updateDirection(sa, typo.id, { industryId: 'nope' })).rejects.toMatchObject({ code: 'invalid_industry' })
      await service.mergeDirection(sa, typo.id, main.id)
      await expect(service.updateDirection(sa, typo.id, { name: 'Boşqa' })).rejects.toMatchObject({ code: 'invalid_merge' })
    })
  })

  it('merging a direction moves every reference at once and adds up what both had; the old name finds the main one', async () => {
    const s = await setup('ra-merge')
    await s.inT(async () => {
      const db = ctx.prisma.client
      const main = await s.dir('Dasturlaş')
      const dup = await s.dir('Programmalaş')
      const older = await s.dir('Kod yozuv')
      await service.mergeDirection(sa, older.id, dup.id) // dup already has an alias of its own
      const both = await s.inst('IT texnikumi', 'IMPORT', true)
      const onlyDup = await s.inst('Boşqa texnikum', 'IMPORT', true)
      await db.institutionDirection.createMany({ data: [
        { tenantId: s.tenantId, institutionId: both.id, directionId: main.id, studentsCount: 100 },
        { tenantId: s.tenantId, institutionId: both.id, directionId: dup.id, studentsCount: 30 },
        { tenantId: s.tenantId, institutionId: onlyDup.id, directionId: dup.id, studentsCount: 50 },
      ] })
      const stu = await s.student({ institutionId: both.id, directionId: dup.id, graduationYear: Y })
      await db.companyDirection.createMany({ data: [{ companyId: s.company.id, directionId: main.id }, { companyId: s.company.id, directionId: dup.id }] })
      const vacancy = await db.vacancy.create({ data: { tenantId: s.tenantId, companyId: s.company.id, kind: 'PRACTICE', title: 'Python', regionId: s.tashkent.id, format: 'ONSITE', seats: 2, directions: { create: [{ directionId: dup.id }] } } })
      const request = await db.trainingRequest.create({ data: { tenantId: s.tenantId, companyId: s.company.id, directionId: dup.id, count: 10, byYear: Y + 1 } })
      const ann = await db.graduationAnnouncement.create({ data: { tenantId: s.tenantId, institutionId: both.id, year: Y, status: 'PUBLISHED', publishedAt: new Date() } })
      const lineMain = await db.announcementLine.create({ data: { announcementId: ann.id, directionId: main.id, count: 40 } })
      const lineDup = await db.announcementLine.create({ data: { announcementId: ann.id, directionId: dup.id, count: 10 } })
      await db.announcementResponse.create({ data: { tenantId: s.tenantId, announcementId: ann.id, companyId: s.company.id, lines: { create: [{ lineId: lineMain.id, wantedCount: 3 }, { lineId: lineDup.id, wantedCount: 2 }] } } })

      await expect(service.mergeDirection(sa, main.id, main.id)).rejects.toMatchObject({ code: 'invalid_merge' })
      await expect(service.mergeDirection(sa, main.id, older.id)).rejects.toMatchObject({ code: 'invalid_merge' })
      const res = await service.mergeDirection(sa, dup.id, main.id)
      expect(res.moved).toMatchObject({ institutions: 2, students: 1, companies: 1, vacancies: 1, announcementLines: 1, trainingRequests: 1, aliases: 1 })

      expect(await db.institutionDirection.findMany({ where: { institutionId: { in: [both.id, onlyDup.id] } }, orderBy: { studentsCount: 'asc' }, select: { institutionId: true, directionId: true, studentsCount: true } })).toEqual([
        { institutionId: onlyDup.id, directionId: main.id, studentsCount: 50 },
        { institutionId: both.id, directionId: main.id, studentsCount: 130 },
      ])
      expect((await db.studentProfile.findUniqueOrThrow({ where: { userId: stu.id } })).directionId).toBe(main.id)
      expect(await db.companyDirection.findMany({ where: { companyId: s.company.id }, select: { directionId: true } })).toEqual([{ directionId: main.id }])
      expect(await db.vacancyDirection.findMany({ where: { vacancyId: vacancy.id }, select: { directionId: true } })).toEqual([{ directionId: main.id }])
      expect((await db.trainingRequest.findUniqueOrThrow({ where: { id: request.id } })).directionId).toBe(main.id)
      const lines = await db.announcementLine.findMany({ where: { announcementId: ann.id }, select: { id: true, count: true, responseLines: { select: { wantedCount: true } } } })
      expect(lines).toEqual([{ id: lineMain.id, count: 50, responseLines: [{ wantedCount: 5 }] }])
      expect(await db.direction.findMany({ where: { id: { in: [dup.id, older.id] } }, select: { mergedIntoId: true } })).toEqual([{ mergedIntoId: main.id }, { mergedIntoId: main.id }])
      // Typing the old names suggests the main direction; the list hides aliases unless asked.
      expect((await registry.suggestDirections({ q: 'programmala' })).map((d) => d.id)).toEqual([main.id])
      expect((await registry.suggestDirections({ q: 'kod yoz' })).map((d) => d.id)).toEqual([main.id])
      const page = await service.directions({ q: '', merged: 'false', page: 1 })
      expect(page.items.map((d) => d.id)).toEqual([main.id])
      expect(page.items[0]).toMatchObject({ aliases: 2, usage: { students: 1, institutions: 2, companies: 1, announcements: 1, trainingRequests: 1, vacancies: 1 } })
      expect((await service.directions({ q: '', merged: 'true', page: 1 })).total).toBe(3)
      await expect(service.mergeDirection(sa, dup.id, main.id)).rejects.toMatchObject({ code: 'invalid_merge' })
    })
  })

  it('search shows the ministry list, approved and student-added records — not a self-registered name nobody approved (security review №45)', async () => {
    const s = await setup('ra-search')
    await s.inT(async () => {
      const db = ctx.prisma.client
      const imported = await s.inst('Qidiruv texnikumi Bir', 'IMPORT')
      const student = await s.inst('Qidiruv texnikumi Ikki', 'STUDENT')
      const approved = await db.institution.create({ data: { tenantId: s.tenantId, type: 'TECHNIKUM', name: 'Qidiruv texnikumi Uç', searchKey: registrySearchKey('Qidiruv texnikumi Uç'), source: 'SELF', status: 'APPROVED', approvedAt: new Date(), regionId: s.tashkent.id } })
      for (const status of ['DRAFT', 'PENDING', 'REJECTED'] as const) {
        await db.institution.create({ data: { tenantId: s.tenantId, type: 'TECHNIKUM', name: `Qidiruv texnikumi ${status}`, searchKey: registrySearchKey(`Qidiruv texnikumi ${status}`), source: 'SELF', status, regionId: s.tashkent.id } })
      }
      expect((await registry.searchInstitutions({ q: 'qidiruv texnikumi' })).map((i) => i.id).sort()).toEqual([imported.id, student.id, approved.id].sort())
    })
  })

  it('a student adds at most 3 institutions and 20 directions a day — the questionnaire path included (security review №44)', async () => {
    const s = await setup('ra-limit')
    await s.inT(async () => {
      const me = { id: (await ctx.makeStudent(s.tenantId)).id, roles: ['STUDENT'] } as RequestActor
      for (let i = 1; i <= 3; i++) await registry.addStudentInstitution(s.tenantId, me, { name: `Limit texnikumi ${i}`, type: 'TECHNIKUM', regionId: s.tashkent.id })
      // An existing name is not a new entry and does not count.
      expect(await registry.addStudentInstitution(s.tenantId, me, { name: 'Limit texnikumi 1', type: 'TECHNIKUM', regionId: s.tashkent.id })).toMatchObject({ created: false })
      await expect(registry.addStudentInstitution(s.tenantId, me, { name: 'Limit texnikumi 4', type: 'TECHNIKUM', regionId: s.tashkent.id })).rejects.toMatchObject({ code: 'rate_limited' })
      for (let i = 1; i <= 20; i++) await registry.addDirection(s.tenantId, me, { name: `Limit yönaliş ${i}`, industryId: s.it.id })
      await expect(registry.addDirection(s.tenantId, me, { name: 'Limit yönaliş 21', industryId: s.it.id })).rejects.toMatchObject({ code: 'rate_limited' })
      // Saves sent at once do not slip past the limit together (review 11.11): one account, 6 at once, 3 a day.
      const other = { id: (await ctx.prisma.client.user.create({ data: { tenantId: s.tenantId, phoneE164: '+998907770011', displayName: 'Racer', roles: ['STUDENT'] } })).id, roles: ['STUDENT'] } as RequestActor
      const burst = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => registry.addStudentInstitution(s.tenantId, other, { name: `Poyga texnikumi ${i}`, type: 'TECHNIKUM', regionId: s.tashkent.id })))
      expect(burst.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    })
  })

  it('a student-added institution merges into the registry record: students move and are confirmed anew; adding it again finds the target', async () => {
    const s = await setup('ra-inst')
    await s.inT(async () => {
      const db = ctx.prisma.client
      const real = await s.inst('Toşkent axborot texnologiyalari texnikumi', 'IMPORT', true)
      const typed = await s.inst('Toşkent axborot texnologiyalari', 'STUDENT')
      const studying = await s.student({ institutionId: typed.id, institutionType: 'COLLEGE' })
      const applying = await s.student({ institutionId: typed.id, mode: 'APPLYING' })
      const [listed] = await service.studentInstitutions({ q: '' })
      expect(listed).toMatchObject({ id: typed.id, students: 2, candidates: [{ id: real.id, name: real.name }] })

      await expect(service.mergeInstitution(sa, real.id, typed.id)).rejects.toMatchObject({ code: 'invalid_merge' })
      const claimed = await s.inst('Claimed', 'STUDENT')
      await db.user.create({ data: { tenantId: s.tenantId, login: 'rep-claimed', displayName: 'Rep', roles: ['INSTITUTION_ADMIN'], institutionId: claimed.id } })
      await expect(service.mergeInstitution(sa, claimed.id, real.id)).rejects.toMatchObject({ code: 'invalid_merge' })

      const res = await service.mergeInstitution(sa, typed.id, real.id)
      expect(res.moved).toEqual({ students: 2, toConfirm: 1, branches: 0 })
      expect(await db.studentProfile.findUniqueOrThrow({ where: { userId: studying.id }, select: { institutionId: true, institutionType: true, studyConfirmation: true } })).toEqual({ institutionId: real.id, institutionType: 'TECHNIKUM', studyConfirmation: 'PENDING' })
      expect((await db.studentProfile.findUniqueOrThrow({ where: { userId: applying.id } })).studyConfirmation).toBe('NONE')
      expect(await service.studentInstitutions({ q: '' })).toEqual([expect.objectContaining({ id: claimed.id })])
      // Hidden from search; a student typing the same name gets the registry record, not a new duplicate.
      expect((await registry.searchInstitutions({ q: 'axborot texnologiyalari' })).map((i) => i.id)).toEqual([real.id])
      const again = await registry.addStudentInstitution(s.tenantId, { id: studying.id, roles: ['STUDENT'] }, { name: 'Toşkent axborot texnologiyalari', type: 'TECHNIKUM', regionId: s.tashkent.id })
      expect(again).toMatchObject({ created: false, institution: { id: real.id } })
      await expect(service.mergeInstitution(sa, typed.id, real.id)).rejects.toMatchObject({ code: 'invalid_merge' })
      expect(await db.auditEvent.count({ where: { action: 'registry.institution.merge', entityId: typed.id } })).toBe(1)
    })
  })
})
