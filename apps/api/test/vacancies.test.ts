import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EMPTY_QUESTIONNAIRE, registrySearchKey, type StudentQuestionnaire } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { APPROVED_KEY } from '../src/common/registry-access'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import type { NotifyInput, NotificationsService } from '../src/modules/notifications/notifications.service'
import { RegistryService } from '../src/modules/registry/registry.service'
import { StudentsService } from '../src/modules/students/students.service'
import { CompanyVacanciesController, StudentVacanciesController } from '../src/modules/vacancies/vacancies.controller'
import { ApplyInput, VacancyInput, type VacancyInput as VacancyInputT } from '../src/modules/vacancies/vacancies.schemas'
import { VacanciesService } from '../src/modules/vacancies/vacancies.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'

const Y = new Date().getUTCFullYear()
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

describe('Practice and internships: access and input', () => {
  it('approved companies publish; students see and apply', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CompanyVacanciesController)).toEqual(['COMPANY_ADMIN'])
    expect(Reflect.getMetadata(APPROVED_KEY, CompanyVacanciesController)).toBe('company')
    expect(Reflect.getMetadata(ROLES_KEY, StudentVacanciesController)).toEqual(['STUDENT'])
  })

  it('seats > 0, the deadline not before today, a stipend only when paid, no markup, no status', () => {
    const pipe = new ZodValidationPipe(VacancyInput)
    const ok = { kind: 'PRACTICE', title: ' Python   amaliyot ', directionIds: ['d'], region: 'tashkent-city', format: 'ONSITE', paid: true, stipend: 2_000_000, seats: 3, deadline: day(0) }
    expect(pipe.transform(ok)).toMatchObject({ title: 'Python amaliyot', deadline: day(0) })
    for (const bad of [{ seats: 0 }, { deadline: day(-1) }, { deadline: '2026-02-30' }, { paid: false }, { title: '<b>x</b>' }, { requirements: '<script>' }, { directionIds: [] }, { status: 'CLOSED' }, { companyId: 'x' }]) {
      expect(() => pipe.transform({ ...ok, ...bad })).toThrow()
    }
    expect(() => new ZodValidationPipe(ApplyInput).transform({ note: 'Salom' })).toThrow()
  })
})

describe.skipIf(!DB_AVAILABLE)('Practice and internships (ТЗ 5.4)', () => {
  const ctx = new TestContext()
  const sent: NotifyInput[] = []
  const notifications = {
    notify: async (n: NotifyInput) => (sent.push(n), n.userIds.length),
    safely: async (_l: string, fn: () => Promise<unknown>) => { await fn() },
  } as unknown as NotificationsService
  class MemoryDocs extends PrivateDocsService {
    constructor() { super(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })) }
    override async downloadUrl(key: string) { return `https://s3.test/ilmora-docs/${key}?X-Amz-Expires=300` }
  }
  const docs = new MemoryDocs()
  const students = new StudentsService(ctx.prisma, ctx.audit, notifications, new RegistryService(ctx.prisma, ctx.audit))
  const contacts = new ContactsService(ctx.prisma, ctx.audit, notifications, docs)
  const service = new VacanciesService(ctx.prisma, ctx.audit, notifications, contacts, students, docs)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const tenantId = t.tenantId
    await TenantContext.system(() => seedRegistryReference(db as never, tenantId))
    return TenantContext.forTenant(tenantId, async () => {
      await db.region.updateMany({ where: { code: '1726' }, data: { slug: 'tashkent-city' } })
      await db.region.updateMany({ where: { code: '1703' }, data: { slug: 'andijan' } })
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const furniture = await db.industry.findFirstOrThrow({ where: { slug: 'furniture' } })
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const andijan = await db.region.findFirstOrThrow({ where: { code: '1703' } })
      const dasturlash = await db.direction.create({ data: { tenantId, name: 'Dasturlaş', searchKey: registrySearchKey('Dasturlaş'), industryId: it.id } })
      const alias = await db.direction.create({ data: { tenantId, name: 'Programmalaş', searchKey: registrySearchKey('Programmalaş'), industryId: it.id, mergedIntoId: dasturlash.id } })
      const mebel = await db.direction.create({ data: { tenantId, name: 'Mebel', searchKey: registrySearchKey('Mebel'), industryId: furniture.id } })
      const inst = await db.institution.create({ data: { id: `pe-1-${tenantId}`, tenantId, type: 'TECHNIKUM', name: 'Toşkent IT texnikumi', searchKey: registrySearchKey('Toşkent IT texnikumi'), regionId: tashkent.id, source: 'IMPORT', status: 'APPROVED', approvedAt: new Date() } })
      let n = 0
      const company = async (name: string, stir: string, approved = true) => {
        const row = await db.company.create({ data: { tenantId, stir, name, searchKey: registrySearchKey(name), status: approved ? 'APPROVED' : 'PENDING', approvedAt: approved ? new Date() : null, regionId: tashkent.id } })
        await db.companyIndustry.create({ data: { companyId: row.id, industryId: it.id } })
        const u = await db.user.create({ data: { tenantId, login: `co-${label}-${++n}`, displayName: `Rep ${n}`, roles: ['COMPANY_ADMIN'], companyId: row.id } })
        return { row, actor: { id: u.id, roles: ['COMPANY_ADMIN'] } as RequestActor }
      }
      const q: StudentQuestionnaire = {
        ...EMPTY_QUESTIONNAIRE, status: 'STUDYING', institutionType: 'TECHNIKUM', institution: { id: inst.id, name: inst.name, region: 'tashkent-city' },
        course: 3, direction: { id: dasturlash.id, name: 'Dasturlaş' }, studyForm: 'GRANT', graduationYear: Y + 1,
        fullName: 'Aziz Karimov', birthDate: `${Y - 20}-05-01`, region: 'tashkent-city', district: 'Çilonzor', phone: '+998 93 555 44 33', email: 'aziz@mail.uz', about: 'Python', consents: {},
      }
      const student = async (complete = true) => {
        const me = { id: (await ctx.makeStudent(tenantId)).id, roles: ['STUDENT'] } as RequestActor
        if (complete) await students.save(tenantId, me, q as never)
        return me
      }
      const input = (over: Partial<VacancyInputT> = {}): VacancyInputT => ({
        kind: 'PRACTICE', title: 'Python amaliyoti', directionIds: [dasturlash.id], region: 'tashkent-city', format: 'ONSITE', paid: true, stipend: 2_000_000,
        duration: '2 oy', seats: 3, requirements: 'Python asoslari', deadline: day(10), address: 'Yunusobod', ...over,
      })
      return {
        tenantId, it, furniture, tashkent, andijan, dasturlash, alias, mebel, student, input,
        inT: <T>(fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn),
        softCo: await company('Soft Co', '401111111'),
        otherCo: await company('Data Co', '402222222'),
        pendingCo: await company('Yangi Co', '403333333', false),
      }
    })
  }

  it('a company publishes, edits while open and closes its vacancy; others get 404', async () => {
    const s = await setup('vac-crud')
    await s.inT(async () => {
      await expect(service.create(s.tenantId, s.softCo.actor, s.input({ region: 'mars' }))).rejects.toMatchObject({ code: 'invalid_region' })
      await expect(service.create(s.tenantId, s.softCo.actor, s.input({ directionIds: ['nope'] }))).rejects.toMatchObject({ code: 'invalid_direction' })
      const otherDistrict = await ctx.prisma.client.district.create({ data: { tenantId: s.tenantId, regionId: s.andijan.id, code: `d-${s.tenantId}`, name: { uz: 'Asaka' } } })
      await expect(service.create(s.tenantId, s.softCo.actor, s.input({ districtId: otherDistrict.id }))).rejects.toMatchObject({ code: 'invalid_district' })

      sent.length = 0
      const v = await service.create(s.tenantId, s.softCo.actor, s.input({ directionIds: [s.alias.id, s.dasturlash.id] }))
      expect(v).toMatchObject({ status: 'OPEN', kind: 'PRACTICE', title: 'Python amaliyoti', region: { id: s.tashkent.id }, paid: true, stipend: 2_000_000, seats: 3, deadline: day(10), applications: { NEW: 0, VIEWED: 0, INVITED: 0, REJECTED: 0 } })
      // The alias stands for its main direction, once.
      expect(v.directions.map((d) => d.id)).toEqual([s.dasturlash.id])
      expect(sent).toEqual([]) // no notifications to students (ТЗ 13.11)

      const edited = await service.update(s.softCo.actor, v.id, { paid: false, seats: 5, directionIds: [s.dasturlash.id, s.mebel.id] })
      expect(edited).toMatchObject({ paid: false, stipend: null, seats: 5 })
      expect(edited.directions.map((d) => d.id).sort()).toEqual([s.dasturlash.id, s.mebel.id].sort())
      await expect(service.update(s.softCo.actor, v.id, { stipend: 100 })).rejects.toMatchObject({ code: 'validation_failed' })

      for (const call of [() => service.companyGet(s.otherCo.actor, v.id), () => service.update(s.otherCo.actor, v.id, { seats: 1 }), () => service.close(s.otherCo.actor, v.id), () => service.applications(s.tenantId, s.otherCo.actor, v.id)]) {
        await expect(call()).rejects.toMatchObject({ code: 'not_found' })
      }
      expect((await service.close(s.softCo.actor, v.id)).status).toBe('CLOSED')
      await expect(service.close(s.softCo.actor, v.id)).rejects.toMatchObject({ code: 'vacancy_closed' })
      await expect(service.update(s.softCo.actor, v.id, { seats: 1 })).rejects.toMatchObject({ code: 'vacancy_closed' })
      expect((await service.companyList(s.softCo.actor)).map((x) => x.id)).toEqual([v.id])
      expect(await service.companyList(s.otherCo.actor)).toEqual([])
    })
  })

  it('students see open vacancies of approved companies before the deadline, filtered by industry, region, kind', async () => {
    const s = await setup('vac-list')
    await s.inT(async () => {
      const me = await s.student(false)
      const python = await service.create(s.tenantId, s.softCo.actor, s.input())
      const remote = await service.create(s.tenantId, s.otherCo.actor, s.input({ kind: 'INTERNSHIP', title: 'Mebel dizayn', directionIds: [s.mebel.id], region: 'andijan', format: 'REMOTE', deadline: null }))
      const closed = await service.create(s.tenantId, s.softCo.actor, s.input({ title: 'Yopiq' }))
      await service.close(s.softCo.actor, closed.id)
      const pending = await service.create(s.tenantId, s.pendingCo.actor, s.input({ title: 'Tasdiqlanmagan' }))
      const late = await service.create(s.tenantId, s.softCo.actor, s.input({ title: 'Kech' }))
      await ctx.prisma.client.vacancy.update({ where: { id: late.id }, data: { deadline: new Date(`${day(-1)}T00:00:00Z`) } })

      expect((await service.list(me, {})).map((v) => v.id).sort()).toEqual([python.id, remote.id].sort())
      expect((await service.list(me, { industry: 'it', region: 'tashkent-city' })).map((v) => v.id)).toEqual([python.id])
      expect((await service.list(me, { industry: s.furniture.id })).map((v) => v.id)).toEqual([remote.id])
      expect((await service.list(me, { kind: 'INTERNSHIP', format: 'REMOTE' })).map((v) => v.id)).toEqual([remote.id])
      expect(await service.list(me, { region: 'mars' })).toEqual([])
      const one = await service.get(me, python.id)
      expect(one).toMatchObject({ company: { name: 'Soft Co', industries: [expect.objectContaining({ slug: 'it' })] }, myApplication: null, requirements: 'Python asoslari' })
      for (const id of [closed.id, pending.id, late.id]) await expect(service.get(me, id)).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('apply once with a complete questionnaire → the company sees the full card (audited) → viewed → invited, the student told each time', async () => {
    const s = await setup('vac-apply')
    await s.inT(async () => {
      const v = await service.create(s.tenantId, s.softCo.actor, s.input())
      await expect(service.apply(s.tenantId, await s.student(false), v.id, { consent: true })).rejects.toMatchObject({ code: 'questionnaire_incomplete' })
      const me = await s.student()
      sent.length = 0
      const applied = await service.apply(s.tenantId, me, v.id, { note: 'Python bilaman', consent: true })
      expect(applied.myApplication).toMatchObject({ status: 'NEW' })
      expect(sent).toEqual([expect.objectContaining({ type: 'vacancy.application', userIds: [s.softCo.actor.id], params: expect.objectContaining({ vacancyTitle: 'Python amaliyoti' }) })])
      await expect(service.apply(s.tenantId, me, v.id, { consent: true })).rejects.toMatchObject({ code: 'application_exists' })
      expect((await service.companyGet(s.softCo.actor, v.id)).applications.NEW).toBe(1)

      const cert = await ctx.prisma.client.studentCertificate.create({ data: { tenantId: s.tenantId, userId: me.id, title: 'IELTS 7.0', fileKey: `student-certs/${s.tenantId}/${me.id}/1.pdf`, contentType: 'application/pdf', sizeBytes: 100 } })
      sent.length = 0
      const [app] = await service.applications(s.tenantId, s.softCo.actor, v.id)
      expect(app).toMatchObject({ status: 'VIEWED', note: 'Python bilaman', student: { id: me.id, name: 'Aziz Karimov', phone: '+998935554433', email: 'aziz@mail.uz', certificates: [expect.objectContaining({ title: 'IELTS 7.0' })] } })
      expect(sent).toEqual([expect.objectContaining({ type: 'vacancy.applicationViewed', userIds: [me.id], params: expect.objectContaining({ companyName: 'Soft Co' }) })])
      // Opening again does not tell the student again.
      sent.length = 0
      await service.applications(s.tenantId, s.softCo.actor, v.id)
      expect(sent).toEqual([])
      expect(await ctx.prisma.client.auditEvent.count({ where: { action: 'vacancy.application.view', entityId: me.id } })).toBe(2)

      expect((await service.certificateLink(s.softCo.actor, app.id, cert.id)).url).toContain(cert.fileKey)
      await expect(service.certificateLink(s.otherCo.actor, app.id, cert.id)).rejects.toMatchObject({ code: 'not_found' })
      await expect(service.setStatus(s.tenantId, s.otherCo.actor, app.id, 'INVITED')).rejects.toMatchObject({ code: 'not_found' })

      const [invited] = await service.setStatus(s.tenantId, s.softCo.actor, app.id, 'INVITED')
      expect(invited.status).toBe('INVITED')
      expect(sent).toEqual([expect.objectContaining({ type: 'vacancy.applicationInvited', userIds: [me.id] })])
      await expect(service.setStatus(s.tenantId, s.softCo.actor, app.id, 'REJECTED')).rejects.toMatchObject({ code: 'application_decided' })

      const [mine] = await service.myApplications(me)
      expect(mine).toMatchObject({ status: 'INVITED', note: 'Python bilaman', vacancy: { id: v.id, title: 'Python amaliyoti', company: { name: 'Soft Co' } } })
      // A closed vacancy leaves the list, the application stays with the student.
      await service.close(s.softCo.actor, v.id)
      expect(await service.list(me, {})).toEqual([])
      expect(await service.myApplications(me)).toHaveLength(1)
      await expect(service.apply(s.tenantId, await s.student(), v.id, { consent: true })).rejects.toMatchObject({ code: 'not_found' })
    })
  })
})
