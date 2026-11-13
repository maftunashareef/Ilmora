import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EMPTY_QUESTIONNAIRE, registrySearchKey, STUDENT_CONSENT_TEXT_VERSION, type StudentQuestionnaire } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import { CompanyStudentsService } from '../src/modules/graduates/company-students.service'
import { ManageService } from '../src/modules/manage/manage.service'
import { NotificationsService } from '../src/modules/notifications/notifications.service'
import { RegistryService } from '../src/modules/registry/registry.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { StudentsController } from '../src/modules/students/students.controller'
import { ConsentKindParam, QuestionnaireInput } from '../src/modules/students/students.schemas'
import { StudentsService } from '../src/modules/students/students.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'

const Y = new Date().getUTCFullYear()
const adultBirth = `${Y - 20}-05-01`
const minorBirth = `${Y - 16}-05-01`

describe('Student consents: access and input', () => {
  it('a student gives and takes back the four consents of their own; contacts for a company are not one of them', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StudentsController)).toEqual(['STUDENT'])
    const pipe = new ZodValidationPipe(ConsentKindParam)
    for (const kind of ['GRADUATE_CARD', 'CONTRACT_HELP_CARD', 'INDUSTRY_CARD', 'PARENT_CONSENT']) expect(pipe.transform(kind)).toBe(kind)
    for (const bad of ['COMPANY_CONTACTS', 'industry_card', '', undefined]) expect(() => pipe.transform(bad)).toThrow()
  })

  it('the questionnaire still takes `consents` and `guardianConsent` (it is sent back whole), but not unknown consents', () => {
    const pipe = new ZodValidationPipe(QuestionnaireInput)
    expect(() => pipe.transform({ ...EMPTY_QUESTIONNAIRE, guardianConsent: true, consents: { INDUSTRY_CARD: true } })).not.toThrow()
    expect(() => pipe.transform({ ...EMPTY_QUESTIONNAIRE, consents: { PARENT_CONSENT: true } })).toThrow()
  })
})

/**
 * Consents are given and taken back by their own actions (ТЗ 8, «Мои согласия»): taking one back never depends on the
 * questionnaire, and saving the questionnaire never changes them.
 */
describe.skipIf(!DB_AVAILABLE)('Student consents: «дать согласие» and «отозвать» as separate actions (ТЗ 8)', () => {
  const ctx = new TestContext()
  const notifications = new NotificationsService(ctx.prisma, { publish: async () => undefined } as never)
  class MemoryDocs extends PrivateDocsService {
    constructor() { super(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })) }
  }
  const contacts = new ContactsService(ctx.prisma, ctx.audit, notifications, new MemoryDocs())
  const students = new StudentsService(ctx.prisma, ctx.audit, notifications, new RegistryService(ctx.prisma, ctx.audit))
  const section = new CompanyStudentsService(ctx.prisma, ctx.audit, contacts, ctx.env)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /** An approved IT technikum, two approved IT companies, students who fill in the questionnaire through the real service. */
  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const tenantId = t.tenantId
    await TenantContext.system(() => seedRegistryReference(db as never, tenantId))
    return TenantContext.forTenant(tenantId, async () => {
      await db.region.updateMany({ where: { code: '1726' }, data: { slug: 'tashkent-city' } })
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const dasturlash = await db.direction.create({ data: { tenantId, name: 'Dasturlaş', searchKey: registrySearchKey('Dasturlaş'), industryId: it.id } })
      const inst = await db.institution.create({ data: { tenantId, type: 'TECHNIKUM', name: 'Toşkent IT texnikumi', searchKey: registrySearchKey('Toşkent IT texnikumi'), regionId: tashkent.id, source: 'IMPORT', status: 'APPROVED', approvedAt: new Date() } })
      await db.institutionDirection.create({ data: { tenantId, institutionId: inst.id, directionId: dasturlash.id, studentsCount: 50 } })
      let n = 0
      const company = async (name: string, stir: string) => {
        const row = await db.company.create({ data: { tenantId, stir, name, searchKey: registrySearchKey(name), status: 'APPROVED', approvedAt: new Date(), regionId: tashkent.id } })
        await db.companyIndustry.create({ data: { companyId: row.id, industryId: it.id } })
        const u = await db.user.create({ data: { tenantId, login: `co-${label}-${++n}`, displayName: `Rep ${n}`, roles: ['COMPANY_ADMIN'], companyId: row.id } })
        return { row, actor: { id: u.id, roles: ['COMPANY_ADMIN'] } as RequestActor }
      }
      /** A complete «уже учусь» questionnaire of an adult at the technikum. */
      const q = (over: Partial<StudentQuestionnaire> = {}): StudentQuestionnaire => ({
        ...EMPTY_QUESTIONNAIRE, status: 'STUDYING', institutionType: 'TECHNIKUM', institution: { id: inst.id, name: inst.name, region: 'tashkent-city' },
        course: 2, direction: { id: dasturlash.id, name: 'Dasturlaş' }, studyForm: 'GRANT', graduationYear: Y + 2,
        fullName: 'Aziz Karimov', birthDate: adultBirth, region: 'tashkent-city', district: 'Çilonzor', phone: '+998 93 555 44 33', email: 'aziz@mail.uz', about: 'Python', ...over,
      })
      const account = async () => ({ id: (await ctx.makeStudent(tenantId)).id, roles: ['STUDENT'] }) as RequestActor
      const save = (me: RequestActor, body: StudentQuestionnaire, ip?: string) => students.save(tenantId, me, body as never, ip)
      /** A student with a saved questionnaire whose study the institution confirmed. */
      const student = async (over: Partial<StudentQuestionnaire> = {}) => {
        const me = await account()
        await save(me, q(over), '10.0.0.1')
        await db.studentProfile.update({ where: { userId: me.id }, data: { studyConfirmation: 'CONFIRMED' } })
        return me
      }
      const softCo = await company('Soft Co', '401111111')
      const dataCo = await company('Data Co', '403333333')
      const cards = async (co = softCo) => (await section.page(co.actor, inst.id, {}, 1)).items
      const journal = (me: RequestActor, kind: string) => db.studentConsent.findMany({ where: { userId: me.id, kind: kind as never }, orderBy: [{ givenAt: 'asc' }, { id: 'asc' }] })
      const inForce = (me: RequestActor, kind?: string) => db.studentConsent.count({ where: { userId: me.id, revokedAt: null, ...(kind ? { kind: kind as never } : {}) } })
      return { tenantId, db, inst, softCo, dataCo, q, account, save, student, cards, journal, inForce, inT: <T>(fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn) }
    })
  }

  it('INDUSTRY_CARD is taken back although the questionnaire no longer passes its rules: the row stays with the date, the card and «Запросить контакты» are gone; given again — a new row', async () => {
    const s = await setup('sc-revoke')
    await s.inT(async () => {
      const me = await s.student()
      await students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD', '10.0.0.7')
      const [card] = await s.cards()
      expect(card).toMatchObject({ name: 'Aziz Karimov' })
      // The year of graduation has passed: the questionnaire cannot be saved any more, as it is.
      await s.db.studentProfile.update({ where: { userId: me.id }, data: { graduationYear: Y - 1 } })
      expect((await students.questionnaire(me)).complete).toBe(false)
      await expect(s.save(me, s.q({ graduationYear: Y - 1 }))).rejects.toMatchObject({ code: 'questionnaire_incomplete', details: { step: 2 } })
      expect(await s.cards()).toHaveLength(1)

      const after = await students.revokeConsent(s.tenantId, me, 'INDUSTRY_CARD')
      expect(after).toEqual([expect.objectContaining({ kind: 'INDUSTRY_CARD', active: false, revokedAt: expect.any(String), textVersion: STUDENT_CONSENT_TEXT_VERSION })])
      const [row] = await s.journal(me, 'INDUSTRY_CARD')
      expect(row).toMatchObject({ ip: '10.0.0.7', revokedAt: expect.any(Date) })
      // At the next read the student is not in the company's section, and the old card id answers 404.
      expect(await s.cards()).toEqual([])
      expect(await section.blocks(s.softCo.actor, {})).toEqual([])
      await expect(section.request(s.tenantId, s.softCo.actor, s.inst.id, card.cardId)).rejects.toMatchObject({ code: 'not_found', status: 404 })
      // Taking back what is not in force changes nothing.
      expect(await students.revokeConsent(s.tenantId, me, 'INDUSTRY_CARD')).toHaveLength(1)
      expect(await students.revokeConsent(s.tenantId, me, 'GRADUATE_CARD')).toHaveLength(1)

      // Given again: a new row with the version, the time and the IP; the journal holds both.
      const again = await students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD', '10.0.0.8')
      expect(again.map((c) => c.active).sort()).toEqual([false, true])
      const rows = await s.journal(me, 'INDUSTRY_CARD')
      expect(rows).toHaveLength(2)
      expect(rows[0].id).toBe(row.id)
      expect(rows[1]).toMatchObject({ ip: '10.0.0.8', revokedAt: null, textVersion: STUDENT_CONSENT_TEXT_VERSION })
      expect((await s.cards()).map((c) => c.name)).toEqual(['Aziz Karimov'])
    })
  })

  it('saving the questionnaire changes no consent: a body from a tab opened before the revocation does not give it back', async () => {
    const s = await setup('sc-stale')
    await s.inT(async () => {
      // A new questionnaire with every mark set gives nothing.
      const me = await s.student({ consents: { INDUSTRY_CARD: true, GRADUATE_CARD: true, CONTRACT_HELP_CARD: true } })
      expect(await s.inForce(me)).toBe(0)
      await students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD')
      await students.giveConsent(s.tenantId, me, 'GRADUATE_CARD')
      // The old tab still says «on»: the consent taken back stays taken back.
      await students.revokeConsent(s.tenantId, me, 'INDUSTRY_CARD')
      const saved = await s.save(me, s.q({ about: 'Python, SQL', consents: { INDUSTRY_CARD: true, GRADUATE_CARD: true } }))
      expect(saved.questionnaire).toMatchObject({ about: 'Python, SQL', consents: { INDUSTRY_CARD: false, GRADUATE_CARD: true, CONTRACT_HELP_CARD: false } })
      expect(await s.inForce(me, 'INDUSTRY_CARD')).toBe(0)
      expect(await s.cards()).toEqual([])
      // …and a body that says «off» takes nothing back either.
      await s.save(me, s.q({ consents: { GRADUATE_CARD: false } }))
      expect(await s.inForce(me, 'GRADUATE_CARD')).toBe(1)
      expect(await s.journal(me, 'INDUSTRY_CARD')).toHaveLength(1)
    })
  })

  it('a minor gives the card consents only with the parent’s details and consent in force; an adult has no parent consent to give', async () => {
    const s = await setup('sc-minor')
    await s.inT(async () => {
      const guardian = { birthDate: minorBirth, guardianName: 'Karim Karimov', guardianPhone: '90 765 43 21' }
      // A minor's first questionnaire still needs the parent's details and the mark.
      const me = await s.account()
      await expect(s.save(me, s.q({ birthDate: minorBirth }))).rejects.toMatchObject({ code: 'questionnaire_incomplete', details: { step: 3, errors: { guardianName: 'q.err.guardianName', guardianConsent: 'q.err.guardianConsent' } } })
      await expect(s.save(me, s.q(guardian))).rejects.toMatchObject({ code: 'questionnaire_incomplete', details: { step: 3, errors: { guardianConsent: 'q.err.guardianConsent' } } })
      // Without a questionnaire no consent is given.
      await expect(students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD')).rejects.toMatchObject({ code: 'questionnaire_required', status: 422 })
      await expect(students.giveConsent(s.tenantId, me, 'PARENT_CONSENT')).rejects.toMatchObject({ code: 'questionnaire_required' })

      // The parent's consent is not in force (taken back): the service refuses the card consents.
      const noParent = await s.student({ ...guardian, guardianConsent: true })
      await s.db.studentConsent.updateMany({ where: { userId: noParent.id, kind: 'PARENT_CONSENT' }, data: { revokedAt: new Date() } })
      for (const kind of ['INDUSTRY_CARD', 'GRADUATE_CARD', 'CONTRACT_HELP_CARD'] as const) await expect(students.giveConsent(s.tenantId, noParent, kind)).rejects.toMatchObject({ code: 'parent_consent_required', status: 422 })
      expect(await s.inForce(noParent)).toBe(0)
      // …and without the parent's name or phone in the questionnaire even the parent's consent is refused.
      await s.db.studentProfile.update({ where: { userId: noParent.id }, data: { parentPhone: null } })
      await expect(students.giveConsent(s.tenantId, noParent, 'PARENT_CONSENT')).rejects.toMatchObject({ code: 'guardian_details_required' })
      await expect(students.giveConsent(s.tenantId, noParent, 'INDUSTRY_CARD')).rejects.toMatchObject({ code: 'guardian_details_required' })
      await s.db.studentProfile.update({ where: { userId: noParent.id }, data: { parentPhone: '+998907654321' } })
      await students.giveConsent(s.tenantId, noParent, 'PARENT_CONSENT', '10.0.0.3')
      await students.giveConsent(s.tenantId, noParent, 'INDUSTRY_CARD')
      expect((await s.cards()).map((c) => c.name)).toEqual(['Aziz Karimov'])

      // An adult: the card consents at once, the parent's consent never.
      const adult = await s.student({ fullName: 'Bobur Aliyev' })
      await expect(students.giveConsent(s.tenantId, adult, 'PARENT_CONSENT')).rejects.toMatchObject({ code: 'parent_consent_adult' })
      await students.giveConsent(s.tenantId, adult, 'INDUSTRY_CARD')
      expect((await s.cards()).map((c) => c.name).sort()).toEqual(['Aziz Karimov', 'Bobur Aliyev'])
      await expect(students.giveConsent(s.tenantId, { id: adult.id, roles: ['TEACHER'] }, 'GRADUATE_CARD')).rejects.toMatchObject({ code: 'forbidden' })
    })
  })

  it('the parent’s consent taken back hides the minor’s cards at once, does not block the questionnaire and does not come back with it', async () => {
    const s = await setup('sc-parent')
    await s.inT(async () => {
      const guardian = { birthDate: minorBirth, guardianName: 'Karim Karimov', guardianPhone: '90 765 43 21' }
      // The first questionnaire gives the parent's consent with its mark.
      const me = await s.student({ ...guardian, guardianConsent: true })
      expect(await students.questionnaire(me)).toMatchObject({ complete: true, parentConsentOnRecord: true, questionnaire: { guardianConsent: true } })
      await students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD')
      expect(await s.cards()).toHaveLength(1)

      await students.revokeConsent(s.tenantId, me, 'PARENT_CONSENT')
      expect(await s.cards()).toEqual([])
      expect(await section.blocks(s.softCo.actor, {})).toEqual([])
      // The card consent itself is not touched, and no new one is given while the parent's consent is out.
      expect(await s.inForce(me, 'INDUSTRY_CARD')).toBe(1)
      await expect(students.giveConsent(s.tenantId, me, 'GRADUATE_CARD')).rejects.toMatchObject({ code: 'parent_consent_required' })

      // The questionnaire stays and is saved without the mark…
      const saved = await s.save(me, s.q({ ...guardian, guardianConsent: false, about: 'Yangi matn' }))
      expect(saved).toMatchObject({ complete: false, parentConsentOnRecord: true, questionnaire: { about: 'Yangi matn', guardianConsent: false, guardianName: 'Karim Karimov' } })
      // …the parent's details are still required…
      await expect(s.save(me, s.q({ birthDate: minorBirth }))).rejects.toMatchObject({ code: 'questionnaire_incomplete', details: { step: 3, errors: { guardianName: 'q.err.guardianName' } } })
      // …and a tab opened before the revocation, with the mark set, does not give the consent back.
      await s.save(me, s.q({ ...guardian, guardianConsent: true }))
      expect(await s.inForce(me, 'PARENT_CONSENT')).toBe(0)
      expect(await s.cards()).toEqual([])

      // Given again on «Мои согласия»: a new row, and the card shows again.
      await students.giveConsent(s.tenantId, me, 'PARENT_CONSENT', '10.0.0.4')
      expect((await s.journal(me, 'PARENT_CONSENT')).map((r) => r.revokedAt === null)).toEqual([false, true])
      expect(await s.cards()).toHaveLength(1)
      // Of age: the next save closes the parent's consent, as before.
      await s.save(me, s.q())
      expect(await s.inForce(me, 'PARENT_CONSENT')).toBe(0)
      expect(await s.journal(me, 'PARENT_CONSENT')).toHaveLength(2)
    })
  })

  it('a contact request waiting for an answer stays with the student, contacts already opened stay with the company', async () => {
    const s = await setup('sc-contacts')
    await s.inT(async () => {
      const me = await s.student()
      await students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD')
      await section.request(s.tenantId, s.softCo.actor, s.inst.id, (await s.cards(s.softCo))[0].cardId)
      await section.request(s.tenantId, s.dataCo.actor, s.inst.id, (await s.cards(s.dataCo))[0].cardId)
      const fromData = (await contacts.studentList(me)).find((r) => r.company.name === 'Data Co')!
      await contacts.decide(s.tenantId, me, fromData.id, true, '10.0.0.5')
      expect(await contacts.companyList(s.dataCo.actor)).toHaveLength(1)

      await students.revokeConsent(s.tenantId, me, 'INDUSTRY_CARD')
      expect(await s.cards(s.softCo)).toEqual([])
      expect(await s.cards(s.dataCo)).toEqual([])
      const list = await contacts.studentList(me)
      expect(list.map((r) => `${r.company.name}:${r.status}`).sort()).toEqual(['Data Co:ACCEPTED', 'Soft Co:PENDING'])
      // The company that was let in keeps the contacts; the consent to it is its own row, not touched by the card's.
      expect(await contacts.companyList(s.dataCo.actor)).toHaveLength(1)
      expect(await s.inForce(me, 'COMPANY_CONTACTS')).toBe(1)
      // The waiting request can still be declined.
      const fromSoft = list.find((r) => r.company.name === 'Soft Co')!
      expect((await contacts.decide(s.tenantId, me, fromSoft.id, false)).find((r) => r.id === fromSoft.id)).toMatchObject({ status: 'DECLINED' })
    })
  })

  it('several «дать согласие» at once leave one row in force', async () => {
    const s = await setup('sc-race')
    await s.inT(async () => {
      const me = await s.student()
      await Promise.all(Array.from({ length: 5 }, () => students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD')))
      expect(await s.journal(me, 'INDUSTRY_CARD')).toHaveLength(1)
      // A revocation in the middle of them: whatever the order, never two rows in force.
      await Promise.all([students.giveConsent(s.tenantId, me, 'GRADUATE_CARD'), students.revokeConsent(s.tenantId, me, 'INDUSTRY_CARD'), students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD'), students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD')])
      expect(await s.inForce(me, 'INDUSTRY_CARD')).toBeLessThanOrEqual(1)
      expect(await s.inForce(me, 'GRADUATE_CARD')).toBe(1)
    })
  })

  it('giving and taking back are in the audit log, with the kind of consent', async () => {
    const s = await setup('sc-audit')
    await s.inT(async () => {
      const me = await s.student({ birthDate: minorBirth, guardianName: 'Karim Karimov', guardianPhone: '90 765 43 21', guardianConsent: true })
      await students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD')
      await students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD')
      await students.revokeConsent(s.tenantId, me, 'INDUSTRY_CARD')
      await students.revokeConsent(s.tenantId, me, 'INDUSTRY_CARD')
      const [card] = await s.journal(me, 'INDUSTRY_CARD')
      const [parent] = await s.journal(me, 'PARENT_CONSENT')
      const events = await s.db.auditEvent.findMany({ where: { entityType: 'StudentConsent', entityId: { in: [card.id, parent.id] } }, orderBy: { createdAt: 'asc' }, select: { action: true, entityId: true, after: true, reason: true } })
      // One event per change: a second «дать» or «отозвать» that changed nothing writes none.
      expect(events).toEqual([
        { action: 'student.consent.give', entityId: parent.id, after: { kind: 'PARENT_CONSENT', userId: me.id, textVersion: STUDENT_CONSENT_TEXT_VERSION }, reason: 'questionnaire' },
        { action: 'student.consent.give', entityId: card.id, after: { kind: 'INDUSTRY_CARD', userId: me.id, textVersion: STUDENT_CONSENT_TEXT_VERSION }, reason: null },
        { action: 'student.consent.revoke', entityId: card.id, after: { kind: 'INDUSTRY_CARD', userId: me.id }, reason: null },
      ])
      // A refused consent leaves neither a row nor an event.
      await students.revokeConsent(s.tenantId, me, 'PARENT_CONSENT')
      await expect(students.giveConsent(s.tenantId, me, 'GRADUATE_CARD')).rejects.toMatchObject({ code: 'parent_consent_required' })
      expect(await s.journal(me, 'GRADUATE_CARD')).toEqual([])
      expect(await s.db.auditEvent.count({ where: { entityType: 'StudentConsent', action: 'student.consent.revoke', entityId: parent.id } })).toBe(1)
    })
  })

  it('an applicant is not offered «компании моей отрасли»: the service refuses it; the other consents are theirs to give', async () => {
    const s = await setup('sc-applying')
    await s.inT(async () => {
      const me = await s.account()
      await s.save(me, s.q({ status: 'APPLYING', course: null, graduationYear: null, admissionYear: Y + 1, studyForm: 'UNKNOWN' }))
      await expect(students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD')).rejects.toMatchObject({ code: 'consent_studying_only', status: 422 })
      expect(await s.inForce(me)).toBe(0)
      expect((await students.giveConsent(s.tenantId, me, 'GRADUATE_CARD')).map((c) => c.kind)).toEqual(['GRADUATE_CARD'])
    })
  })

  it('deleting the account closes the consents in force and keeps every row of the journal', async () => {
    const s = await setup('sc-delete')
    const manage = new ManageService(ctx.prisma, ctx.audit, {} as SessionsService, {} as SiteService, notificationsStub, ctx.env)
    await s.inT(async () => {
      const me = await s.student()
      const other = await s.student({ fullName: 'Bobur Aliyev' })
      for (const kind of ['INDUSTRY_CARD', 'GRADUATE_CARD', 'CONTRACT_HELP_CARD'] as const) await students.giveConsent(s.tenantId, me, kind)
      await students.revokeConsent(s.tenantId, me, 'CONTRACT_HELP_CARD')
      await students.giveConsent(s.tenantId, other, 'INDUSTRY_CARD')
      // Contacts opened to a company: a consent in force too.
      await section.request(s.tenantId, s.softCo.actor, s.inst.id, (await s.cards()).find((c) => c.name === 'Aziz Karimov')!.cardId)
      await contacts.decide(s.tenantId, me, (await contacts.studentList(me))[0].id, true)
      const before = await s.db.studentConsent.findMany({ where: { userId: me.id }, orderBy: { id: 'asc' } })
      expect(before.filter((r) => r.revokedAt === null).map((r) => r.kind).sort()).toEqual(['COMPANY_CONTACTS', 'GRADUATE_CARD', 'INDUSTRY_CARD'])
      const revokedEarlier = before.find((r) => r.kind === 'CONTRACT_HELP_CARD')!
      // The company holds a copy of the contacts and opens the contact card; a second company's request still waits.
      await section.request(s.tenantId, s.dataCo.actor, s.inst.id, (await s.cards(s.dataCo)).find((c) => c.name === 'Aziz Karimov')!.cardId)
      const accepted = await s.db.contactRequest.findFirstOrThrow({ where: { userId: me.id, companyId: s.softCo.row.id } })
      expect(accepted).toMatchObject({ status: 'ACCEPTED', sharedName: 'Aziz Karimov', sharedPhone: '+998935554433', sharedEmail: 'aziz@mail.uz' })
      expect((await contacts.companyContact(s.softCo.actor, accepted.id)).student.full).toMatchObject({ phone: '+998935554433' })

      await manage.deleteUser(s.tenantId, { id: 'admin', roles: ['PLATFORM_ADMIN'], centerId: null }, me.id, 'test')
      const after = await s.db.studentConsent.findMany({ where: { userId: me.id }, orderBy: { id: 'asc' } })
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id))
      expect(after.every((r) => r.revokedAt !== null)).toBe(true)
      // The date of an earlier revocation is not rewritten; the rows closed now carry the moment of the deletion.
      expect(after.find((r) => r.id === revokedEarlier.id)!.revokedAt).toEqual(revokedEarlier.revokedAt)
      const [{ deletedAt }] = (await TenantContext.system(() => s.db.user.findMany({ where: { id: { in: [me.id] } }, select: { deletedAt: true }, includeDeleted: true } as never))) as unknown as { deletedAt: Date }[]
      expect(after.filter((r) => r.id !== revokedEarlier.id).every((r) => r.revokedAt!.getTime() === deletedAt.getTime())).toBe(true)
      // The copy of the contacts goes with the consent, as on «Отозвать доступ»: the opened request is withdrawn and
      // empty, the company gets neither the list entry nor the contact card; the waiting request is left as it was.
      expect(await s.db.contactRequest.findUniqueOrThrow({ where: { id: accepted.id } })).toMatchObject({ status: 'WITHDRAWN', sharedName: null, sharedPhone: null, sharedEmail: null })
      expect(await s.db.contactRequest.findFirstOrThrow({ where: { userId: me.id, companyId: s.dataCo.row.id } })).toMatchObject({ status: 'PENDING', sharedName: null, sharedPhone: null, sharedEmail: null })
      expect(await contacts.companyList(s.softCo.actor)).toEqual([])
      await expect(contacts.companyContact(s.softCo.actor, accepted.id)).rejects.toMatchObject({ code: 'not_found', status: 404 })
      // Another student's consents are not touched; the deleted account gives no consent any more.
      expect(await s.inForce(other)).toBe(1)
      expect((await s.cards()).map((c) => c.name)).toEqual(['Bobur Aliyev'])
      await expect(students.giveConsent(s.tenantId, me, 'INDUSTRY_CARD')).rejects.toMatchObject({ code: 'questionnaire_required' })
    })
  })
})
