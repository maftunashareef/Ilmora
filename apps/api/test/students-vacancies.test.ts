import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EMPTY_QUESTIONNAIRE, registrySearchKey, VACANCY_BROADCASTS_PER_DAY } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { APPROVED_KEY } from '../src/common/registry-access'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import { CompanyStudentsService } from '../src/modules/graduates/company-students.service'
import { CompanyStudentsController } from '../src/modules/graduates/graduates.controller'
import { MinistryStatsService } from '../src/modules/ministry/ministry-stats.service'
import { MinistryController } from '../src/modules/ministry/ministry.controller'
import { NotificationsService } from '../src/modules/notifications/notifications.service'
import { RegistryService } from '../src/modules/registry/registry.service'
import { StudentsService } from '../src/modules/students/students.service'
import { deliverBroadcast, InstitutionVacanciesService } from '../src/modules/vacancies/institution-vacancies.service'
import { InstitutionVacanciesController } from '../src/modules/vacancies/vacancies.controller'
import { BroadcastInput, VacancyInput } from '../src/modules/vacancies/vacancies.schemas'
import { VacanciesService } from '../src/modules/vacancies/vacancies.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { unzip } from './support/xlsx'

const Y = new Date().getUTCFullYear()

describe('ТЗ «Студенты у компании, Вакансии у учреждения»: access and input', () => {
  it('«Студенты» — approved companies; «Вакансии компаний» — approved institutions', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CompanyStudentsController)).toEqual(['COMPANY_ADMIN'])
    expect(Reflect.getMetadata(APPROVED_KEY, CompanyStudentsController)).toBe('company')
    expect(Reflect.getMetadata(ROLES_KEY, InstitutionVacanciesController)).toEqual(['INSTITUTION_ADMIN'])
    expect(Reflect.getMetadata(APPROVED_KEY, InstitutionVacanciesController)).toBe('institution')
  })

  it('«Работа»: always paid, a salary from–to and no stipend; a salary only on a job', () => {
    const pipe = new ZodValidationPipe(VacancyInput)
    const job = { kind: 'JOB', title: 'Junior dasturçi', directionIds: ['d'], region: 'tashkent-city', format: 'ONSITE', paid: true, seats: 1, schedule: 'FULL_TIME', experience: 'NONE' }
    expect(pipe.transform({ ...job, salaryFrom: 5_000_000, salaryTo: 8_000_000 })).toMatchObject({ kind: 'JOB', salaryFrom: 5_000_000, schedule: 'FULL_TIME', experience: 'NONE' })
    // A job names its schedule and the experience asked for; practice and internships have neither.
    for (const bad of [{ schedule: null }, { experience: undefined }, { schedule: 'NIGHTS' }]) expect(() => pipe.transform({ ...job, ...bad })).toThrow()
    for (const bad of [{ schedule: 'FULL_TIME' }, { experience: 'NONE' }]) expect(() => pipe.transform({ kind: 'PRACTICE', title: 'Amaliyot', directionIds: ['d'], region: 'tashkent-city', format: 'ONSITE', paid: false, seats: 1, ...bad })).toThrow()
    expect(pipe.transform({ ...job, salaryFrom: 5_000_000 })).not.toHaveProperty('salaryTo')
    for (const bad of [{ paid: false }, { stipend: 100 }, { salaryTo: 1_000 }, { salaryFrom: 9_000, salaryTo: 1_000 }]) expect(() => pipe.transform({ ...job, ...bad })).toThrow()
    expect(() => pipe.transform({ ...job, kind: 'PRACTICE', salaryFrom: 1_000 })).toThrow()
  })

  it('a broadcast names at least one direction; years 1–11 are optional — none means all', () => {
    const pipe = new ZodValidationPipe(BroadcastInput)
    expect(pipe.transform({ directionIds: ['d'], courses: [3, 1, 3] })).toEqual({ directionIds: ['d'], courses: [1, 3] })
    expect(pipe.transform({ directionIds: ['d'], courses: [] })).toEqual({ directionIds: ['d'], courses: [] })
    expect(pipe.transform({ directionIds: ['d'] })).toEqual({ directionIds: ['d'], courses: [] })
    for (const bad of [{ directionIds: [], courses: [1] }, { courses: [1] }, { directionIds: ['d'], courses: [12] }, { directionIds: ['d'], courses: [0] }]) expect(() => pipe.transform(bad)).toThrow()
  })
})

describe.skipIf(!DB_AVAILABLE)('ТЗ «Студенты у компании, Вакансии у учреждения»', () => {
  const ctx = new TestContext()
  const notifications = new NotificationsService(ctx.prisma, { publish: async () => undefined } as never)
  class MemoryDocs extends PrivateDocsService {
    constructor() { super(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })) }
  }
  const docs = new MemoryDocs()
  const contacts = new ContactsService(ctx.prisma, ctx.audit, notifications, docs)
  const studentsSvc = new StudentsService(ctx.prisma, ctx.audit, notifications, new RegistryService(ctx.prisma, ctx.audit))
  const section = new CompanyStudentsService(ctx.prisma, ctx.audit, contacts, ctx.env)
  const vacancies = new VacanciesService(ctx.prisma, ctx.audit, notifications, contacts, studentsSvc, docs)
  const instVacancies = new InstitutionVacanciesService(ctx.prisma, ctx.audit, ctx.outbox)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const tenantId = t.tenantId
    await TenantContext.system(() => seedRegistryReference(db as never, tenantId))
    return TenantContext.forTenant(tenantId, async () => {
      await db.region.updateMany({ where: { code: '1726' }, data: { slug: 'tashkent-city' } })
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const furniture = await db.industry.findFirstOrThrow({ where: { slug: 'furniture' } })
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const andijan = await db.region.findFirstOrThrow({ where: { code: '1703' } })
      const dir = (name: string, industryId: string, mergedIntoId?: string) => db.direction.create({ data: { tenantId, name, searchKey: registrySearchKey(name), industryId, mergedIntoId } })
      const dasturlash = await dir('Dasturlaş', it.id)
      const alias = await dir('Programmalaş', it.id, dasturlash.id)
      const kiber = await dir('Kiberxavfsizlik', it.id)
      const mebel = await dir('Mebel', furniture.id)
      let n = 0
      const user = (roles: string[], link: object) => db.user.create({ data: { tenantId, login: `u-${label}-${++n}`, displayName: `Rep ${n}`, roles: roles as never, ...link } })
      const institution = async (name: string, regionId: string, type: 'TECHNIKUM' | 'COLLEGE', directions: string[]) => {
        const row = await db.institution.create({ data: { tenantId, type, name, searchKey: registrySearchKey(name), regionId, source: 'IMPORT', status: 'APPROVED', approvedAt: new Date() } })
        for (const directionId of directions) await db.institutionDirection.create({ data: { tenantId, institutionId: row.id, directionId, studentsCount: 50 } })
        const u = await user(['INSTITUTION_ADMIN'], { institutionId: row.id })
        return { row, actor: { id: u.id, roles: ['INSTITUTION_ADMIN'] } as RequestActor }
      }
      const company = async (name: string, stir: string, industryIds: string[], regionId = tashkent.id) => {
        const row = await db.company.create({ data: { tenantId, stir, name, searchKey: registrySearchKey(name), status: 'APPROVED', approvedAt: new Date(), regionId } })
        for (const industryId of industryIds) await db.companyIndustry.create({ data: { companyId: row.id, industryId } })
        const u = await user(['COMPANY_ADMIN'], { companyId: row.id })
        return { row, actor: { id: u.id, roles: ['COMPANY_ADMIN'] } as RequestActor }
      }
      const andijanTech = await institution('Andijon texnikumi', andijan.id, 'TECHNIKUM', [dasturlash.id])
      const tashkentCol = await institution('Toşkent kolleji', tashkent.id, 'COLLEGE', [dasturlash.id, kiber.id, mebel.id])
      const noDirections = await institution('Yangi kollej', tashkent.id, 'COLLEGE', [])
      type S = { name: string; inst: { row: { id: string } }; dir?: string | null; course?: number; year?: number; mode?: 'STUDYING' | 'APPLYING'; confirmed?: boolean; consents?: string[]; born?: string; active?: boolean }
      /** A student straight in the database: profile, consents. */
      const student = async (s: S) => {
        const u = await db.user.create({ data: { tenantId, displayName: s.name, phoneE164: `+99890${String(++n).padStart(3, '0')}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`, phoneVerifiedAt: new Date(), email: `s${n}@mail.uz`, roles: ['STUDENT'], isActive: s.active ?? true } })
        await db.studentProfile.create({
          data: {
            tenantId, userId: u.id, mode: s.mode ?? 'STUDYING', institutionType: 'TECHNIKUM', institutionId: s.inst.row.id, course: s.course ?? 2, graduationYear: s.year ?? Y + 2,
            directionId: s.dir === undefined ? dasturlash.id : s.dir, birthDate: new Date(`${s.born ?? `${Y - 20}-05-01`}T00:00:00Z`), regionId: tashkent.id, about: 'Python',
            contactPhone: '+998935554433', studyConfirmation: s.confirmed === false ? 'PENDING' : 'CONFIRMED',
          },
        })
        for (const kind of s.consents ?? ['INDUSTRY_CARD']) await db.studentConsent.create({ data: { tenantId, userId: u.id, kind: kind as never, textVersion: 'v1' } })
        return { id: u.id, roles: ['STUDENT'] } as RequestActor
      }
      return {
        tenantId, it, furniture, tashkent, andijan, dasturlash, alias, kiber, mebel, andijanTech, tashkentCol, noDirections, student,
        inT: <T>(fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn),
        softCo: await company('Soft Co', '401111111', [it.id]),
        mebelCo: await company('Mebel Co', '402222222', [furniture.id]),
        dataCo: await company('Data Co', '403333333', [it.id]),
      }
    })
  }

  it('«Студенты»: only studying, confirmed, consented, adult or with the parent, active, of the company’s industries', async () => {
    const s = await setup('st-who')
    await s.inT(async () => {
      const shown = [
        await s.student({ name: 'Aziz', inst: s.tashkentCol }),
        await s.student({ name: 'Bobur', inst: s.tashkentCol, dir: s.alias.id }),
        await s.student({ name: 'Dilnoza', inst: s.andijanTech, course: 4 }),
        await s.student({ name: 'Eldor', inst: s.tashkentCol, born: `${Y - 16}-01-01`, consents: ['INDUSTRY_CARD', 'PARENT_CONSENT'] }),
      ]
      await s.student({ name: 'No consent', inst: s.tashkentCol, consents: [] })
      await s.student({ name: 'Graduate only', inst: s.tashkentCol, consents: ['GRADUATE_CARD'] })
      await s.student({ name: 'Unconfirmed', inst: s.tashkentCol, confirmed: false })
      await s.student({ name: 'Applying', inst: s.tashkentCol, mode: 'APPLYING' })
      await s.student({ name: 'Minor', inst: s.tashkentCol, born: `${Y - 15}-01-01` })
      await s.student({ name: 'Disabled', inst: s.tashkentCol, active: false })
      await s.student({ name: 'Mebelçi', inst: s.tashkentCol, dir: s.mebel.id })

      // Blocks: the company's region (Tashkent) first, then by the number of students.
      expect(await section.blocks(s.softCo.actor, {})).toEqual([
        { institution: expect.objectContaining({ id: s.tashkentCol.row.id, name: 'Toşkent kolleji', type: 'COLLEGE' }), students: 3 },
        { institution: expect.objectContaining({ id: s.andijanTech.row.id }), students: 1 },
      ])
      const page = await section.page(s.softCo.actor, s.tashkentCol.row.id, {}, 1)
      expect(page).toMatchObject({ total: 3, page: 1, pageSize: 20 })
      expect(page.items.map((c) => c.name)).toEqual(['Aziz', 'Bobur', 'Eldor'])
      // The alias student shows under the main direction; no contacts, birth date or account id on a card.
      expect(page.items[1].direction).toMatchObject({ id: s.dasturlash.id })
      const text = JSON.stringify(page)
      for (const secret of ['+998935554433', '@mail.uz', `${Y - 20}-05-01`, ...shown.map((u) => u.id)]) expect(text).not.toContain(secret)
      expect(Object.keys(page.items[0]).sort()).toEqual(['about', 'cardId', 'certificates', 'contactRequest', 'course', 'direction', 'graduationYear', 'ilmoraCourses', 'institution', 'name', 'region', 'studyConfirmed'])
      // The furniture company sees the furniture student only.
      expect((await section.blocks(s.mebelCo.actor, {})).map((b) => b.students)).toEqual([1])
      // Filters.
      expect((await section.blocks(s.softCo.actor, { course: 4 })).map((b) => b.institution.id)).toEqual([s.andijanTech.row.id])
      expect((await section.blocks(s.softCo.actor, { type: 'TECHNIKUM' })).map((b) => b.institution.id)).toEqual([s.andijanTech.row.id])
      expect((await section.blocks(s.softCo.actor, { region: 'tashkent-city' })).map((b) => b.students)).toEqual([3])
      expect((await section.blocks(s.softCo.actor, { direction: s.alias.id })).map((b) => b.students)).toEqual([3, 1])
      expect(await section.blocks(s.softCo.actor, { direction: s.kiber.id })).toEqual([])
      expect(await section.blocks(s.softCo.actor, { region: 'nowhere' })).toEqual([])
      // A revoked consent hides the card at once; the parent's consent revoked hides a minor.
      await ctx.prisma.client.studentConsent.updateMany({ where: { userId: shown[0].id, kind: 'INDUSTRY_CARD' }, data: { revokedAt: new Date() } })
      await ctx.prisma.client.studentConsent.updateMany({ where: { userId: shown[3].id, kind: 'PARENT_CONSENT' }, data: { revokedAt: new Date() } })
      expect((await section.page(s.softCo.actor, s.tashkentCol.row.id, {}, 1)).items.map((c) => c.name)).toEqual(['Bobur'])
    })
  })

  it('«Запросить контакты»: by the card id only; shared with «Пригласить»; a contract-help request neither shows nor blocks (№126)', async () => {
    const s = await setup('st-request')
    await s.inT(async () => {
      const aziz = await s.student({ name: 'Aziz', inst: s.tashkentCol })
      const bobur = await s.student({ name: 'Bobur', inst: s.tashkentCol })
      const dilnoza = await s.student({ name: 'Dilnoza', inst: s.tashkentCol })
      const cards = async (co = s.softCo) => (await section.page(co.actor, s.tashkentCol.row.id, {}, 1)).items
      const card = async (name: string, co = s.softCo) => (await cards(co)).find((c) => c.name === name)!
      // Card ids are the company's own: another company sees other ids; an account id is not a card id.
      expect((await card('Aziz')).cardId).not.toBe((await card('Aziz', s.dataCo)).cardId)
      await expect(section.request(s.tenantId, s.softCo.actor, s.tashkentCol.row.id, aziz.id)).rejects.toMatchObject({ code: 'not_found' })
      await expect(section.request(s.tenantId, s.softCo.actor, s.andijanTech.row.id, (await card('Aziz')).cardId)).rejects.toMatchObject({ code: 'not_found' })
      await expect(section.request(s.tenantId, s.softCo.actor, s.tashkentCol.row.id, (await card('Aziz', s.dataCo)).cardId)).rejects.toMatchObject({ code: 'not_found' })

      expect(await section.request(s.tenantId, s.softCo.actor, s.tashkentCol.row.id, (await card('Aziz')).cardId)).toMatchObject({ name: 'Aziz', contactRequest: 'PENDING' })
      await expect(section.request(s.tenantId, s.softCo.actor, s.tashkentCol.row.id, (await card('Aziz')).cardId)).rejects.toMatchObject({ code: 'contact_request_exists' })
      const req = await ctx.prisma.client.contactRequest.findFirstOrThrow({ where: { userId: aziz.id, companyId: s.softCo.row.id } })
      expect(req.source).toBe('STUDENTS')
      // An invitation from an announcement is the same named request: its status shows, a second one is refused.
      await contacts.request(s.tenantId, { id: s.softCo.row.id, name: 'Soft Co' }, bobur.id, 'GRADUATE', {})
      expect((await card('Bobur')).contactRequest).toBe('PENDING')
      await expect(section.request(s.tenantId, s.softCo.actor, s.tashkentCol.row.id, (await card('Bobur')).cardId)).rejects.toMatchObject({ code: 'contact_request_exists' })
      // «Заинтересованы» on Dilnoza's anonymous card: not on her named card, and asking by name still works.
      await ctx.prisma.client.contactRequest.create({ data: { tenantId: s.tenantId, companyId: s.softCo.row.id, userId: dilnoza.id, source: 'CONTRACT_HELP' } })
      expect((await card('Dilnoza')).contactRequest).toBeNull()
      expect(await section.request(s.tenantId, s.softCo.actor, s.tashkentCol.row.id, (await card('Dilnoza')).cardId)).toMatchObject({ contactRequest: 'PENDING' })
      expect(await ctx.prisma.client.notification.count({ where: { userId: aziz.id, type: 'contact.request' } })).toBe(1)
    })
  })

  it('«Вакансии компаний»: open vacancies of the institution’s industries, its region first; tabs and filters; no directions — a hint', async () => {
    const s = await setup('iv-list')
    await s.inT(async () => {
      const make = (co: typeof s.softCo, over: object) => vacancies.create(s.tenantId, co.actor, { kind: 'PRACTICE', title: 'Python', directionIds: [s.dasturlash.id], region: 'tashkent-city', format: 'ONSITE', paid: false, seats: 2, ...over } as never)
      const local = await make(s.softCo, { title: 'Toşkent amaliyot' })
      await new Promise((r) => setTimeout(r, 5))
      const far = await make(s.dataCo, { title: 'Andijon amaliyot', region: String(s.andijan.id) })
      const job = await make(s.softCo, { kind: 'JOB', title: 'Junior', paid: true, salaryFrom: 6_000_000, schedule: 'PART_TIME', experience: 'UP_TO_1', format: 'REMOTE', region: String(s.andijan.id) })
      const mebel = await make(s.mebelCo, { title: 'Mebel', directionIds: [s.mebel.id] })
      const closed = await make(s.softCo, { title: 'Yopiq' })
      await vacancies.close(s.softCo.actor, closed.id)

      const tashkentView = await instVacancies.list(s.tashkentCol.actor, {})
      expect(tashkentView.hasDirections).toBe(true)
      expect(tashkentView.items.map((v) => v.title)).toEqual(['Mebel', 'Toşkent amaliyot', 'Junior', 'Andijon amaliyot'])
      expect(tashkentView.items.find((v) => v.id === job.id)).toMatchObject({ kind: 'JOB', salaryFrom: 6_000_000, salaryTo: null, stipend: null, schedule: 'PART_TIME', experience: 'UP_TO_1', sentTo: 0 })
      expect(tashkentView.items.find((v) => v.id === local.id)).toMatchObject({ schedule: null, experience: null })
      // The Andijan technikum (IT only): no furniture; its own region first.
      expect((await instVacancies.list(s.andijanTech.actor, {})).items.map((v) => v.title)).toEqual(['Junior', 'Andijon amaliyot', 'Toşkent amaliyot'])
      expect((await instVacancies.list(s.andijanTech.actor, { kind: 'JOB' })).items.map((v) => v.id)).toEqual([job.id])
      expect((await instVacancies.list(s.andijanTech.actor, { schedule: 'PART_TIME', experience: 'UP_TO_1' })).items.map((v) => v.id)).toEqual([job.id])
      expect((await instVacancies.list(s.andijanTech.actor, { schedule: 'FULL_TIME' })).items).toEqual([])
      expect((await instVacancies.list(s.andijanTech.actor, { paid: 'false', format: 'ONSITE' })).items.map((v) => v.id).sort()).toEqual([local.id, far.id].sort())
      expect((await instVacancies.list(s.tashkentCol.actor, { direction: s.mebel.id })).items.map((v) => v.id)).toEqual([mebel.id])
      await expect(instVacancies.get(s.andijanTech.actor, mebel.id)).rejects.toMatchObject({ code: 'not_found' })
      await expect(instVacancies.get(s.andijanTech.actor, closed.id)).rejects.toMatchObject({ code: 'not_found' })
      expect(await instVacancies.list(s.noDirections.actor, {})).toEqual({ hasDirections: false, items: [] })
      // The ministry's table counts «Работа» too.
      const stats = await new MinistryStatsService(ctx.prisma).one('vacancies', {})
      expect(stats.rows.map((r) => (r.kind as { ru: string }).ru)).toEqual(['Практика', 'Стажировка', 'Работа'])
      expect(stats.rows[2]).toMatchObject({ vacancies: 1, open: 1 })
    })
  })

  it('«Разослать студентам»: own confirmed students on own directions and years, once each, through the queue; the daily limit', async () => {
    const s = await setup('iv-send')
    await s.inT(async () => {
      const v = await vacancies.create(s.tenantId, s.softCo.actor, { kind: 'INTERNSHIP', title: 'Backend stajirovka', directionIds: [s.dasturlash.id], region: 'tashkent-city', format: 'HYBRID', paid: false, seats: 5 } as never)
      const get = [
        await s.student({ name: 'A', inst: s.tashkentCol, course: 3, consents: [] }),
        await s.student({ name: 'B', inst: s.tashkentCol, course: 3, dir: s.alias.id, consents: [] }),
      ]
      await s.student({ name: 'Year 1', inst: s.tashkentCol, course: 1 })
      await s.student({ name: 'Unconfirmed', inst: s.tashkentCol, course: 3, confirmed: false })
      await s.student({ name: 'Disabled', inst: s.tashkentCol, course: 3, active: false })
      await s.student({ name: 'Kiber', inst: s.tashkentCol, course: 3, dir: s.kiber.id })
      await s.student({ name: 'Other institution', inst: s.andijanTech, course: 3 })
      const input = { directionIds: [s.dasturlash.id], courses: [3, 4] }

      // Only the institution's own directions of the vacancy's industry.
      await expect(instVacancies.preview(s.tashkentCol.actor, v.id, { directionIds: [s.mebel.id], courses: [3] })).rejects.toMatchObject({ code: 'invalid_direction' })
      await expect(instVacancies.preview(s.andijanTech.actor, v.id, { directionIds: [s.kiber.id], courses: [3] })).rejects.toMatchObject({ code: 'invalid_direction' })
      expect(await instVacancies.preview(s.tashkentCol.actor, v.id, input)).toEqual({ recipients: 2, alreadySent: 0, leftToday: VACANCY_BROADCASTS_PER_DAY })

      const b = await instVacancies.send(s.tenantId, s.tashkentCol.actor, v.id, input)
      const sender = await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: s.tashkentCol.actor.id }, select: { displayName: true } })
      expect(b).toMatchObject({ vacancyId: v.id, vacancyTitle: 'Backend stajirovka', companyName: 'Soft Co', sentBy: { name: sender.displayName }, courses: [3, 4], recipientsCount: 2, finishedAt: null, directions: [expect.objectContaining({ id: s.dasturlash.id })] })
      // Nothing is delivered until the queue runs the outbox event.
      expect(await ctx.prisma.client.notification.count({ where: { type: 'vacancy.broadcast' } })).toBe(0)
      expect(await TenantContext.system(() => ctx.prisma.client.outboxEvent.count({ where: { type: 'vacancy.broadcast', dedupeKey: `vacancy-broadcast:${b.id}` } }))).toBe(1)
      expect(await deliverBroadcast(ctx.prisma, notifications, b.id)).toEqual({ sent: 2 })
      const got = await ctx.prisma.client.notification.findMany({ where: { type: 'vacancy.broadcast' }, select: { userId: true, params: true } })
      expect(got.map((n) => n.userId).sort()).toEqual(get.map((u) => u.id).sort())
      expect(got[0].params).toMatchObject({ vacancyTitle: 'Backend stajirovka', companyName: 'Soft Co', institutionName: 'Toşkent kolleji', vacancyId: v.id })
      // A second run of the same event adds nobody; a new broadcast to the same students is refused.
      expect(await deliverBroadcast(ctx.prisma, notifications, b.id)).toEqual({ sent: 0 })
      expect(await instVacancies.preview(s.tashkentCol.actor, v.id, input)).toMatchObject({ recipients: 0, alreadySent: 2 })
      await expect(instVacancies.send(s.tenantId, s.tashkentCol.actor, v.id, input)).rejects.toMatchObject({ code: 'no_recipients' })
      expect((await instVacancies.get(s.tashkentCol.actor, v.id)).sentTo).toBe(2)
      expect((await instVacancies.broadcasts(s.tashkentCol.actor, v.id))[0]).toMatchObject({ id: b.id, finishedAt: expect.any(String) })
      // The journal of all its broadcasts (3.2, п. 6); another institution's journal has none of them.
      expect((await instVacancies.broadcasts(s.tashkentCol.actor)).map((x) => x.id)).toEqual([b.id])
      expect(await instVacancies.broadcasts(s.andijanTech.actor)).toEqual([])

      // The daily limit, counted in the database.
      await ctx.prisma.client.vacancyBroadcast.createMany({ data: Array.from({ length: VACANCY_BROADCASTS_PER_DAY - 1 }, () => ({ tenantId: s.tenantId, vacancyId: v.id, institutionId: s.tashkentCol.row.id, courses: [1], createdById: 'x', recipientsCount: 0 })) })
      await s.student({ name: 'New', inst: s.tashkentCol, course: 4 })
      await expect(instVacancies.send(s.tenantId, s.tashkentCol.actor, v.id, input)).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
    })
  })

  it('«Работа» edited: the salary changes; turning it into practice needs the salary cleared; a job stays paid', async () => {
    const s = await setup('iv-job-edit')
    await s.inT(async () => {
      const base = { title: 'Junior', directionIds: [s.dasturlash.id], region: 'tashkent-city', format: 'ONSITE', seats: 1 }
      const job = await vacancies.create(s.tenantId, s.softCo.actor, { ...base, kind: 'JOB', paid: true, salaryFrom: 5_000_000, schedule: 'FULL_TIME', experience: 'NONE' } as never)
      expect(await vacancies.update(s.softCo.actor, job.id, { salaryTo: 7_000_000, schedule: 'SHIFT' })).toMatchObject({ kind: 'JOB', salaryFrom: 5_000_000, salaryTo: 7_000_000, stipend: null, schedule: 'SHIFT', experience: 'NONE' })
      for (const bad of [{ salaryTo: 1_000 }, { paid: false }, { stipend: 100 }, { schedule: null }, { experience: null }, { kind: 'PRACTICE' as const }, { kind: 'PRACTICE' as const, salaryFrom: null, salaryTo: null }]) {
        await expect(vacancies.update(s.softCo.actor, job.id, bad)).rejects.toMatchObject({ code: 'validation_failed' })
      }
      // Into practice: the salary, the schedule and the experience all go (the database refuses them on practice too).
      expect(await vacancies.update(s.softCo.actor, job.id, { kind: 'PRACTICE', salaryFrom: null, salaryTo: null, schedule: null, experience: null, stipend: 1_000_000 })).toMatchObject({ kind: 'PRACTICE', salaryFrom: null, salaryTo: null, schedule: null, experience: null, stipend: 1_000_000 })
      // Back to a job: the stipend has to go, the salary, schedule and experience come.
      await expect(vacancies.update(s.softCo.actor, job.id, { kind: 'JOB', stipend: null, salaryFrom: 6_000_000 })).rejects.toMatchObject({ code: 'validation_failed' })
      expect(await vacancies.update(s.softCo.actor, job.id, { kind: 'JOB', stipend: null, salaryFrom: 6_000_000, schedule: 'FLEXIBLE', experience: 'ONE_TO_3' })).toMatchObject({ kind: 'JOB', stipend: null, salaryFrom: 6_000_000, schedule: 'FLEXIBLE', experience: 'ONE_TO_3' })
      // The ministry's Excel shows «Работа» too.
      const headers: Record<string, string> = {}
      let body: Buffer = Buffer.alloc(0)
      await new MinistryController(new MinistryStatsService(ctx.prisma), {} as never, ctx.audit).export({ table: 'vacancies', lang: 'ru' }, { setHeader: (k: string, v: string) => { headers[k] = v }, send: (b: Buffer) => { body = b } } as never)
      expect(headers['Content-Disposition']).toMatch(/ilmora-vacancies-/)
      expect(unzip(body).get('xl/worksheets/sheet1.xml')).toContain('Работа')
    })
  })

  it('a vacancy closed before the queue ran is not sent', async () => {
    const s = await setup('iv-closed')
    await s.inT(async () => {
      const v = await vacancies.create(s.tenantId, s.softCo.actor, { kind: 'PRACTICE', title: 'Python', directionIds: [s.dasturlash.id], region: 'tashkent-city', format: 'ONSITE', paid: false, seats: 1 } as never)
      await s.student({ name: 'A', inst: s.tashkentCol, course: 2 })
      const b = await instVacancies.send(s.tenantId, s.tashkentCol.actor, v.id, { directionIds: [s.dasturlash.id], courses: [2] })
      await vacancies.close(s.softCo.actor, v.id)
      expect(await deliverBroadcast(ctx.prisma, notifications, b.id)).toEqual({ sent: 0 })
      expect(await ctx.prisma.client.vacancyBroadcastRecipient.count({ where: { broadcastId: b.id } })).toBe(0)
    })
  })

  it('the questionnaire stores the new consent «companies of my industry» in the journal', async () => {
    const s = await setup('st-consent')
    await s.inT(async () => {
      const me = { id: (await ctx.makeStudent(s.tenantId)).id, roles: ['STUDENT'] } as RequestActor
      const q = {
        ...EMPTY_QUESTIONNAIRE, status: 'STUDYING', institutionType: 'TECHNIKUM', institution: { id: s.tashkentCol.row.id, name: 'Toşkent kolleji', region: 'tashkent-city' },
        course: 2, direction: { id: s.dasturlash.id, name: 'Dasturlaş' }, studyForm: 'GRANT', graduationYear: Y + 2,
        fullName: 'Aziz Karimov', birthDate: `${Y - 20}-05-01`, region: 'tashkent-city', district: 'Çilonzor', phone: '+998 93 555 44 33', email: '', about: '', consents: { INDUSTRY_CARD: true },
      }
      const saved = await studentsSvc.save(s.tenantId, me, q as never, '10.0.0.9')
      expect(saved.questionnaire!.consents).toMatchObject({ INDUSTRY_CARD: true, GRADUATE_CARD: false })
      expect(await ctx.prisma.client.studentConsent.findMany({ where: { userId: me.id }, select: { kind: true, ip: true, revokedAt: true } })).toEqual([{ kind: 'INDUSTRY_CARD', ip: '10.0.0.9', revokedAt: null }])
      await studentsSvc.save(s.tenantId, me, { ...q, consents: { INDUSTRY_CARD: false } } as never)
      expect(await ctx.prisma.client.studentConsent.count({ where: { userId: me.id, kind: 'INDUSTRY_CARD', revokedAt: null } })).toBe(0)
    })
  })
})
