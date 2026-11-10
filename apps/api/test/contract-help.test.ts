import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EMPTY_QUESTIONNAIRE, registrySearchKey, type StudentQuestionnaire } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { APPROVED_KEY } from '../src/common/registry-access'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import { CompanyContractHelpController, StudentContractHelpController } from '../src/modules/contract-help/contract-help.controller'
import { ContractHelpInput } from '../src/modules/contract-help/contract-help.schemas'
import { ContractHelpService } from '../src/modules/contract-help/contract-help.service'
import type { NotifyInput, NotificationsService } from '../src/modules/notifications/notifications.service'
import { RegistryService } from '../src/modules/registry/registry.service'
import { StudentsService } from '../src/modules/students/students.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { deepKeys, PRIVATE_KEYS } from './support/keys'

const Y = new Date().getUTCFullYear()
const INPUT = { motivation: 'Oilada imkon yöq, IT sohasida işlamoqçiman.', yearsToWork: 3, workRegion: 'OWN' as const, consent: true as const }

describe('Help with the contract fee: access and input', () => {
  it('students ask; approved companies see the feed', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StudentContractHelpController)).toEqual(['STUDENT'])
    expect(Reflect.getMetadata(ROLES_KEY, CompanyContractHelpController)).toEqual(['COMPANY_ADMIN'])
    expect(Reflect.getMetadata(APPROVED_KEY, CompanyContractHelpController)).toBe('company')
  })

  it('motivation up to 1000 characters without markup, 1–10 years, the consent tick is required', () => {
    const pipe = new ZodValidationPipe(ContractHelpInput)
    expect(pipe.transform({ ...INPUT, motivation: '  Oilada   imkon yöq, yordam kerak  ' })).toMatchObject({ motivation: 'Oilada imkon yöq, yordam kerak' })
    for (const bad of [{ consent: false }, { yearsToWork: 0 }, { yearsToWork: 11 }, { motivation: 'x'.repeat(1001) }, { motivation: '<b>yordam kerak</b>' }, { workRegion: 'MARS' }, { status: 'SIGNED' }]) {
      expect(() => pipe.transform({ ...INPUT, ...bad })).toThrow()
    }
  })
})

describe.skipIf(!DB_AVAILABLE)('Help with the contract fee (ТЗ 5.3)', () => {
  const ctx = new TestContext()
  const sent: NotifyInput[] = []
  const notifications = {
    notify: async (n: NotifyInput) => (sent.push(n), n.userIds.length),
    safely: async (_l: string, fn: () => Promise<unknown>) => { await fn() },
  } as unknown as NotificationsService
  class MemoryDocs extends PrivateDocsService {
    constructor() { super(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })) }
  }
  const students = new StudentsService(ctx.prisma, ctx.audit, notifications, new RegistryService(ctx.prisma, ctx.audit))
  const contacts = new ContactsService(ctx.prisma, ctx.audit, notifications, new MemoryDocs())
  const service = new ContractHelpService(ctx.prisma, ctx.audit, notifications, contacts, students)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /** An approved IT technikum; IT and furniture companies; students who fill in the questionnaire through the real service. */
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
      const inst = await db.institution.create({ data: { id: `pe-1-${tenantId}`, tenantId, type: 'TECHNIKUM', name: 'Toşkent IT texnikumi', searchKey: registrySearchKey('Toşkent IT texnikumi'), regionId: tashkent.id, source: 'IMPORT', status: 'APPROVED', approvedAt: new Date() } })
      let n = 0
      const company = async (name: string, stir: string, industryId: string) => {
        const row = await db.company.create({ data: { tenantId, stir, name, searchKey: registrySearchKey(name), status: 'APPROVED', approvedAt: new Date(), website: `https://${stir}.uz`, address: 'Ofis', regionId: tashkent.id } })
        await db.companyIndustry.create({ data: { companyId: row.id, industryId } })
        const u = await db.user.create({ data: { tenantId, login: `co-${label}-${++n}`, displayName: `Rep ${n}`, jobTitle: 'HR', email: `hr${n}@${stir}.uz`, roles: ['COMPANY_ADMIN'], companyId: row.id } })
        return { row, actor: { id: u.id, roles: ['COMPANY_ADMIN'] } as RequestActor }
      }
      const studying = (over: Partial<StudentQuestionnaire> = {}): StudentQuestionnaire => ({
        ...EMPTY_QUESTIONNAIRE, status: 'STUDYING', institutionType: 'TECHNIKUM', institution: { id: inst.id, name: inst.name, region: 'tashkent-city' },
        course: 2, direction: { id: dasturlash.id, name: 'Dasturlaş' }, studyForm: 'CONTRACT', contractSum: 5_000_000, graduationYear: Y + 1,
        fullName: 'Aziz Karimov', birthDate: `${Y - 20}-05-01`, region: 'tashkent-city', district: 'Çilonzor', phone: '+998 93 555 44 33', email: 'aziz@mail.uz',
        about: 'Python', consents: {}, ...over,
      })
      const student = async (q?: StudentQuestionnaire) => {
        const me = { id: (await ctx.makeStudent(tenantId)).id, roles: ['STUDENT'] } as RequestActor
        if (q) await students.save(tenantId, me, q as never, '10.0.0.1')
        return me
      }
      return {
        tenantId, it, furniture, tashkent, andijan, dasturlash, inst, studying, student,
        inT: <T>(fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn),
        softCo: await company('Soft Co', '401111111', it.id),
        otherIt: await company('Data Co', '402222222', it.id),
        mebelCo: await company('Mebel Co', '403333333', furniture.id),
      }
    })
  }

  it('asks only with a complete contract questionnaire; one open request; the consent row is written; IT companies are told', async () => {
    const s = await setup('ch-create')
    await s.inT(async () => {
      await expect(service.create(s.tenantId, await s.student(), INPUT)).rejects.toMatchObject({ code: 'questionnaire_incomplete' })
      const grant = await s.student(s.studying({ studyForm: 'GRANT', contractSum: null }))
      await expect(service.create(s.tenantId, grant, INPUT)).rejects.toMatchObject({ code: 'contract_help_profile', details: { missing: ['studyForm', 'contractSum'] } })

      const me = await s.student(s.studying())
      sent.length = 0
      const req = await service.create(s.tenantId, me, INPUT, '10.0.0.2')
      expect(req).toMatchObject({ status: 'ACTIVE', yearsToWork: 3, workRegion: { id: s.tashkent.id }, interests: [], signableCompanies: [], signedWith: null })
      expect(sent).toEqual([expect.objectContaining({ type: 'contractHelp.new', dedupeKey: `contract-help:${req.id}`, params: expect.objectContaining({ directionName: 'Dasturlaş' }) })])
      expect(sent[0].userIds.sort()).toEqual([s.softCo.actor.id, s.otherIt.actor.id].sort())
      expect(JSON.stringify(sent[0].params)).not.toContain('Aziz')
      expect(await ctx.prisma.client.studentConsent.findMany({ where: { userId: me.id, kind: 'CONTRACT_HELP_CARD' }, select: { ip: true, revokedAt: true } })).toEqual([{ ip: '10.0.0.2', revokedAt: null }])
      await expect(service.create(s.tenantId, me, INPUT)).rejects.toMatchObject({ code: 'contract_help_exists' })
      // After withdrawing, a new one can be made; «any region» stores no region.
      expect((await service.withdraw(me)).status).toBe('WITHDRAWN')
      await expect(service.withdraw(me)).rejects.toMatchObject({ code: 'not_found' })
      expect(await service.create(s.tenantId, me, { ...INPUT, workRegion: 'ANY' })).toMatchObject({ status: 'ACTIVE', workRegion: null })
    })
  })

  it('companies of the industry see an anonymised card — no name, birth date, phone, e-mail, files or user id', async () => {
    const s = await setup('ch-feed')
    await s.inT(async () => {
      const me = await s.student(s.studying())
      await ctx.prisma.client.studentCertificate.create({ data: { tenantId: s.tenantId, userId: me.id, title: 'IELTS 7.0', fileKey: `student-certs/${s.tenantId}/${me.id}/1.pdf`, contentType: 'application/pdf', sizeBytes: 100 } })
      const req = await service.create(s.tenantId, me, INPUT)
      const [card] = await service.feed(s.softCo.actor, {})
      expect(card).toMatchObject({
        id: req.id, number: req.id.slice(-6).toUpperCase(), status: 'ACTIVE', age: 20, region: { id: s.tashkent.id },
        institution: { name: 'Toşkent IT texnikumi', type: 'TECHNIKUM' }, direction: { id: s.dasturlash.id, industry: { id: s.it.id } },
        mode: 'STUDYING', course: 2, studyForm: 'CONTRACT', contractAmount: 5_000_000, yearsToWork: 3, certificates: ['IELTS 7.0'], studyConfirmed: false, contactRequest: null,
      })
      expect([...deepKeys(await service.feed(s.softCo.actor, {}))].filter((k) => PRIVATE_KEYS.includes(k))).toEqual([])
      const text = JSON.stringify(card)
      for (const secret of ['Aziz', 'Karimov', 'aziz@mail.uz', '+998935554433', `${Y - 20}-05-01`, me.id, 'student-certs', 'Python']) expect(text).not.toContain(secret)
      expect(Object.keys(card)).not.toEqual(expect.arrayContaining(['userId', 'name', 'birthDate', 'phone', 'email']))

      expect(await service.feed(s.mebelCo.actor, {})).toEqual([])
      await expect(service.card(s.mebelCo.actor, req.id)).rejects.toMatchObject({ code: 'not_found' })
      expect(await service.feed(s.softCo.actor, { region: 'andijan' })).toEqual([])
      expect(await service.feed(s.softCo.actor, { region: 'tashkent-city' })).toHaveLength(1)

      // A disabled account leaves the feed (security review №47).
      await ctx.prisma.client.user.update({ where: { id: me.id }, data: { isActive: false } })
      expect(await service.feed(s.softCo.actor, {})).toEqual([])
      await expect(service.card(s.softCo.actor, req.id)).rejects.toMatchObject({ code: 'not_found' })
      await ctx.prisma.client.user.update({ where: { id: me.id }, data: { isActive: true } })
      // Consent 2 revoked in the questionnaire — the card is gone at once; withdrawn — too.
      await students.save(s.tenantId, me, s.studying({ consents: { CONTRACT_HELP_CARD: false } }) as never)
      expect(await service.feed(s.softCo.actor, {})).toEqual([])
      await students.save(s.tenantId, me, s.studying({ consents: { CONTRACT_HELP_CARD: true } }) as never)
      expect(await service.feed(s.softCo.actor, {})).toHaveLength(1)
      await service.withdraw(me)
      expect(await service.feed(s.softCo.actor, {})).toEqual([])
      await expect(service.card(s.softCo.actor, req.id)).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('a minor needs the parent’s consent, and the card shows only with it', async () => {
    const s = await setup('ch-minor')
    await s.inT(async () => {
      const minor = s.studying({ birthDate: `${Y - 16}-05-01`, guardianName: 'Karimova Malika', guardianPhone: '901234568', guardianConsent: true })
      const me = await s.student(minor)
      const req = await service.create(s.tenantId, me, INPUT)
      expect((await service.card(s.softCo.actor, req.id)).age).toBe(16)
      // The parent's consent taken back (straight in the journal): the card is hidden; the questionnaire is incomplete again.
      await ctx.prisma.client.studentConsent.updateMany({ where: { userId: me.id, kind: 'PARENT_CONSENT' }, data: { revokedAt: new Date() } })
      expect(await service.feed(s.softCo.actor, {})).toEqual([])
      await service.withdraw(me)
      await expect(service.create(s.tenantId, me, INPUT)).rejects.toMatchObject({ code: 'questionnaire_incomplete' })
    })
  })

  it('«Заинтересованы» → the student accepts → full card and company contacts → «договор заключён» with that company only', async () => {
    const s = await setup('ch-interest')
    await s.inT(async () => {
      const me = await s.student(s.studying())
      const req = await service.create(s.tenantId, me, INPUT)
      sent.length = 0
      const card = await service.interest(s.tenantId, s.softCo.actor, req.id)
      expect(card).toMatchObject({ status: 'INTERESTED', contactRequest: 'PENDING' })
      expect(sent).toEqual([expect.objectContaining({ type: 'contact.request', userIds: [me.id], params: expect.objectContaining({ companyName: 'Soft Co' }) })])
      await expect(service.interest(s.tenantId, s.softCo.actor, req.id)).rejects.toMatchObject({ code: 'contact_request_exists' })
      await expect(service.interest(s.tenantId, s.mebelCo.actor, req.id)).rejects.toMatchObject({ code: 'not_found' })
      await service.interest(s.tenantId, s.otherIt.actor, req.id)

      const [fromData, fromSoft] = await contacts.studentList(me)
      expect(fromSoft).toMatchObject({ source: 'CONTRACT_HELP', status: 'PENDING', company: { name: 'Soft Co' }, contacts: null })
      expect((await service.mine(me))!.interests.map((i) => i.company.name)).toEqual(['Soft Co', 'Data Co'])
      expect((await contacts.companyContact(s.softCo.actor, fromSoft.id)).student.full).toBeNull()
      // Only a company the student opened contacts to can be named in «договор заключён».
      await expect(service.signed(me, s.softCo.row.id)).rejects.toMatchObject({ code: 'not_found' })

      const decided = await contacts.decide(s.tenantId, me, fromSoft.id, true)
      expect(decided.find((r) => r.id === fromSoft.id)?.contacts).toMatchObject({ website: 'https://401111111.uz', email: 'hr1@401111111.uz', representative: { jobTitle: 'HR' } })
      await contacts.decide(s.tenantId, me, fromData.id, false)
      const full = (await contacts.companyContact(s.softCo.actor, fromSoft.id)).student.full
      expect(full).toMatchObject({ name: 'Aziz Karimov', phone: '+998935554433', email: 'aziz@mail.uz' })
      expect((await service.mine(me))!.signableCompanies).toEqual([{ id: s.softCo.row.id, name: 'Soft Co' }])

      await expect(service.signed(me, s.otherIt.row.id)).rejects.toMatchObject({ code: 'not_found' })
      const signed = await service.signed(me, s.softCo.row.id)
      expect(signed).toMatchObject({ status: 'SIGNED', signedWith: { id: s.softCo.row.id, name: 'Soft Co' } })
      expect(await service.feed(s.otherIt.actor, {})).toEqual([])
      await expect(service.withdraw(me)).rejects.toMatchObject({ code: 'not_found' })
      // Another student cannot see or mark this request.
      expect(await service.mine(await s.student())).toBeNull()
    })
  })
})
