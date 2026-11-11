import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EMPTY_QUESTIONNAIRE, registrySearchKey, type StudentQuestionnaire } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { APPROVED_KEY } from '../src/common/registry-access'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import type { NotifyInput, NotificationsService } from '../src/modules/notifications/notifications.service'
import { RegistryService } from '../src/modules/registry/registry.service'
import { InstitutionStudentsController, StudentsController } from '../src/modules/students/students.controller'
import { QuestionnaireInput } from '../src/modules/students/students.schemas'
import { StudentsService } from '../src/modules/students/students.service'
import { DB_AVAILABLE, TestContext } from './helpers'

const Y = new Date().getUTCFullYear()
const adultBirth = `${Y - 20}-05-01`
const minorBirth = `${Y - 15}-05-01`

describe('Student questionnaire: access and input', () => {
  it('students fill it in; approved institutions confirm', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StudentsController)).toEqual(['STUDENT'])
    expect(Reflect.getMetadata(ROLES_KEY, InstitutionStudentsController)).toEqual(['INSTITUTION_ADMIN'])
    expect(Reflect.getMetadata(APPROVED_KEY, InstitutionStudentsController)).toBe('institution')
  })
  it('takes the wizard’s shape only: no markup, no unknown fields or consents', () => {
    const pipe = new ZodValidationPipe(QuestionnaireInput)
    expect(() => pipe.transform({ ...EMPTY_QUESTIONNAIRE })).not.toThrow()
    expect(() => pipe.transform({ ...EMPTY_QUESTIONNAIRE, about: '<script>x</script>' })).toThrow()
    expect(() => pipe.transform({ ...EMPTY_QUESTIONNAIRE, studyConfirmation: 'CONFIRMED' })).toThrow()
    expect(() => pipe.transform({ ...EMPTY_QUESTIONNAIRE, consents: { COMPANY_CONTACTS: true } })).toThrow()
  })
})

describe.skipIf(!DB_AVAILABLE)('Student questionnaire and confirmation of study (ТЗ 4.1, 8)', () => {
  const ctx = new TestContext()
  const sent: NotifyInput[] = []
  const notifications = {
    notify: async (n: NotifyInput) => (sent.push(n), n.userIds.length),
    safely: async (_l: string, fn: () => Promise<unknown>) => { await fn() },
  } as unknown as NotificationsService
  const service = new StudentsService(ctx.prisma, ctx.audit, notifications, new RegistryService(ctx.prisma, ctx.audit))
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
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const dasturlash = await db.direction.create({ data: { tenantId, name: 'Dasturlaş', searchKey: registrySearchKey('Dasturlaş'), industryId: it.id } })
      const inst = async (id: string, name: string, approved: boolean) => {
        const row = await db.institution.create({ data: { id, tenantId, type: 'TECHNIKUM', name, searchKey: registrySearchKey(name), regionId: tashkent.id, source: 'IMPORT', status: approved ? 'APPROVED' : 'UNCLAIMED', approvedAt: approved ? new Date() : null } })
        const rep = approved ? await db.user.create({ data: { tenantId, login: `rep-${id}`, displayName: 'Rep', roles: ['INSTITUTION_ADMIN'], institutionId: row.id } }) : null
        return { row, actor: rep ? ({ id: rep.id, roles: ['INSTITUTION_ADMIN'] } as RequestActor) : null }
      }
      const approved = await inst(`pe-1-${tenantId}`, 'Toşkent IT texnikumi', true)
      const other = await inst(`pe-2-${tenantId}`, 'Boşqa texnikum', true)
      const unclaimed = await inst(`pe-3-${tenantId}`, 'Hali yöq texnikum', false)
      const student = async () => {
        const u = await ctx.makeStudent(tenantId)
        return { id: u.id, roles: ['STUDENT'] } as RequestActor
      }
      /** A complete «уже учусь» questionnaire at the approved technikum. */
      const studying = (over: Partial<StudentQuestionnaire> = {}): StudentQuestionnaire => ({
        ...EMPTY_QUESTIONNAIRE, status: 'STUDYING', institutionType: 'TECHNIKUM', institution: { id: approved.row.id, name: approved.row.name, region: 'tashkent-city' },
        course: 2, direction: { id: dasturlash.id, name: 'Dasturlaş' }, studyForm: 'CONTRACT', contractSum: 5_000_000, graduationYear: Y + 1,
        fullName: 'Aziz Karimov', birthDate: adultBirth, region: 'tashkent-city', district: 'Çilonzor', phone: '+998 90 123 45 67', email: 'aziz@mail.uz',
        about: 'Python', consents: { GRADUATE_CARD: true }, ...over,
      })
      return { tenantId, it, dasturlash, approved, other, unclaimed, student, studying }
    })
  }

  it('saves the questionnaire and gives it back in the wizard’s shape; the approved institution is asked to confirm', async () => {
    const s = await setup('st-save')
    await TenantContext.forTenant(s.tenantId, async () => {
      const me = await s.student()
      const signInPhoneBefore = (await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: me.id } })).phoneE164
      expect(await service.questionnaire(me)).toEqual({ questionnaire: null, complete: false, studyConfirmed: null })
      sent.length = 0
      const state = await service.save(s.tenantId, me, s.studying() as never, '10.0.0.1')
      expect(state).toMatchObject({ complete: true, studyConfirmed: 'PENDING' })
      expect(state.questionnaire).toMatchObject({
        status: 'STUDYING', institutionType: 'TECHNIKUM', institution: { id: s.approved.row.id, name: 'Toşkent IT texnikumi', region: 'tashkent-city' },
        course: 2, direction: { id: s.dasturlash.id, industryId: s.it.id }, studyForm: 'CONTRACT', contractSum: 5_000_000, graduationYear: Y + 1,
        fullName: 'Aziz Karimov', birthDate: adultBirth, region: 'tashkent-city', district: 'Çilonzor', email: 'aziz@mail.uz', about: 'Python',
        consents: { GRADUATE_CARD: true, CONTRACT_HELP_CARD: false }, guardianConsent: false,
      })
      // The contact phone goes to its own field, normalized; the sign-in number stays as it was.
      expect(state.questionnaire?.phone).toBe('+998901234567')
      expect((await ctx.prisma.client.studentProfile.findUniqueOrThrow({ where: { userId: me.id } })).contactPhone).toBe('+998901234567')
      expect((await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: me.id } })).phoneE164).toBe(signInPhoneBefore)
      expect(sent).toEqual([expect.objectContaining({ type: 'student.studyPending', userIds: [s.approved.actor!.id] })])
      const consent = await ctx.prisma.client.studentConsent.findFirstOrThrow({ where: { userId: me.id } })
      expect(consent).toMatchObject({ kind: 'GRADUATE_CARD', textVersion: '2026-11-10', ip: '10.0.0.1', revokedAt: null })
      expect((await ctx.prisma.client.studentProfile.findUniqueOrThrow({ where: { userId: me.id } })).contractAmountMinor).toBe(500_000_000n)
    })
  })

  it('a student who signed in by SMS gets that number as the default phone; a typed one goes to contactPhone only', async () => {
    const s = await setup('st-phone')
    await TenantContext.forTenant(s.tenantId, async () => {
      const me = await s.student()
      const user = await ctx.prisma.client.user.update({ where: { id: me.id }, data: { phoneVerifiedAt: new Date() } })
      // A profile without its own contact phone (e.g. saved before the field existed) offers the SMS number.
      await ctx.prisma.client.studentProfile.create({ data: { tenantId: s.tenantId, userId: me.id, mode: 'APPLYING' } })
      expect((await service.questionnaire(me)).questionnaire?.phone).toBe(user.phoneE164)
      // Saving another number keeps it as the contact phone and never moves the sign-in number.
      const state = await service.save(s.tenantId, me, s.studying({ phone: '93 111 22 33' }) as never)
      expect(state.questionnaire?.phone).toBe('+998931112233')
      expect((await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: me.id } })).phoneE164).toBe(user.phoneE164)
      // A number not confirmed by SMS is never offered as the default.
      const other = await s.student()
      await ctx.prisma.client.studentProfile.create({ data: { tenantId: s.tenantId, userId: other.id, mode: 'APPLYING' } })
      expect((await service.questionnaire(other)).questionnaire?.phone).toBe('')
    })
  })

  it('refuses an incomplete questionnaire with the step and the fields, like the wizard', async () => {
    const s = await setup('st-incomplete')
    await TenantContext.forTenant(s.tenantId, async () => {
      const me = await s.student()
      await expect(service.save(s.tenantId, me, s.studying({ course: null, studyForm: 'CONTRACT', contractSum: null }) as never)).rejects.toMatchObject({ code: 'questionnaire_incomplete', details: { step: 2, errors: { course: 'q.err.course', contractSum: 'q.err.contractSum' } } })
      await expect(service.save(s.tenantId, me, s.studying({ phone: '12' }) as never)).rejects.toMatchObject({ code: 'questionnaire_incomplete', details: { step: 3 } })
      await expect(service.save(s.tenantId, me, s.studying({ region: 'nowhere' }) as never)).rejects.toMatchObject({ code: 'questionnaire_incomplete' })
      await expect(service.save(s.tenantId, { id: me.id, roles: ['TEACHER'] }, s.studying() as never)).rejects.toMatchObject({ code: 'forbidden' })
    })
  })

  it('an applicant: a university typed by hand goes to the registry, a new direction to the dictionary, «not decided» is kept', async () => {
    const s = await setup('st-apply')
    await TenantContext.forTenant(s.tenantId, async () => {
      const me = await s.student()
      const q: StudentQuestionnaire = {
        ...s.studying(), status: 'APPLYING', institutionType: 'UNIVERSITY', institution: { id: 'tuit-from-the-web-list', name: 'Toşkent axborot texnologiyalari universiteti', region: 'tashkent-city' },
        course: null, graduationYear: null, admissionYear: Y + 1, direction: { name: 'Kiberxavfsizlik', industryId: s.it.id }, studyForm: 'UNKNOWN', contractSum: null,
      }
      const state = await service.save(s.tenantId, me, q as never)
      expect(state).toMatchObject({ complete: true, studyConfirmed: null, questionnaire: { status: 'APPLYING', studyForm: 'UNKNOWN', admissionYear: Y + 1, institutionUndecided: false, direction: { name: 'Kiberxavfsizlik' } } })
      const added = await ctx.prisma.client.institution.findUniqueOrThrow({ where: { id: state.questionnaire!.institution!.id } })
      expect(added).toMatchObject({ source: 'STUDENT', type: 'UNIVERSITY', stir: null })
      expect(await ctx.prisma.client.direction.count({ where: { searchKey: 'kiberxavfsizlik' } })).toBe(1)
      // The same name again finds the same records; «not decided» keeps no institution.
      const again = await service.save(s.tenantId, await s.student(), { ...q, direction: { name: 'КИБЕРХАВФСИЗЛИК' } } as never)
      expect(again.questionnaire?.institution?.id).toBe(added.id)
      expect(again.questionnaire?.direction?.name).toBe('Kiberxavfsizlik')
      const undecided = await service.save(s.tenantId, await s.student(), { ...q, institution: null, institutionUndecided: true } as never)
      expect(undecided.questionnaire).toMatchObject({ institution: null, institutionUndecided: true })
      await expect(service.save(s.tenantId, me, { ...q, direction: { name: 'Hech qayerda yöq' } } as never)).rejects.toMatchObject({ code: 'invalid_direction' })
    })
  })

  it('consents are a journal; a minor needs the parent and their consent', async () => {
    const s = await setup('st-consents')
    await TenantContext.forTenant(s.tenantId, async () => {
      const me = await s.student()
      await expect(service.save(s.tenantId, me, s.studying({ birthDate: minorBirth }) as never)).rejects.toMatchObject({ code: 'questionnaire_incomplete', details: { step: 3, errors: { guardianName: 'q.err.guardianName', guardianConsent: 'q.err.guardianConsent' } } })
      const minor = s.studying({ birthDate: minorBirth, guardianName: 'Karim Karimov', guardianPhone: '90 765 43 21', guardianConsent: true, consents: { GRADUATE_CARD: true, CONTRACT_HELP_CARD: true } })
      const first = await service.save(s.tenantId, me, minor as never)
      expect(first.questionnaire).toMatchObject({ guardianConsent: true, guardianName: 'Karim Karimov', guardianPhone: '+998907654321', consents: { GRADUATE_CARD: true, CONTRACT_HELP_CARD: true } })
      await service.save(s.tenantId, me, { ...minor, consents: { GRADUATE_CARD: false, CONTRACT_HELP_CARD: true } } as never)
      await service.save(s.tenantId, me, { ...minor, consents: { GRADUATE_CARD: true, CONTRACT_HELP_CARD: true } } as never)
      const journal = await ctx.prisma.client.studentConsent.findMany({ where: { userId: me.id, kind: 'GRADUATE_CARD' }, orderBy: { givenAt: 'asc' } })
      expect(journal.map((r) => r.revokedAt === null)).toEqual([false, true])
      expect(await ctx.prisma.client.studentConsent.count({ where: { userId: me.id, kind: 'PARENT_CONSENT', revokedAt: null } })).toBe(1)
      // GET /v1/students/me/consents: in force and the history, nothing erased; one's own only.
      const history = await service.consents(me)
      expect(history.filter((c) => c.kind === 'GRADUATE_CARD').map((c) => c.active).sort()).toEqual([false, true])
      expect(history.filter((c) => c.active).map((c) => c.kind).sort()).toEqual(['CONTRACT_HELP_CARD', 'GRADUATE_CARD', 'PARENT_CONSENT'])
      expect(history.find((c) => !c.active)).toMatchObject({ company: null, textVersion: '2026-11-10', revokedAt: expect.any(String) })
      expect(Object.keys(history[0]).sort()).toEqual(['active', 'company', 'givenAt', 'id', 'kind', 'revokedAt', 'textVersion'])
      expect(await service.consents(await s.student())).toEqual([])
    })
  })

  /** What the institution sees in its list for this student — sent with the decision (Н-8). */
  const seenBy = async (actor: RequestActor, id: string) => {
    const r = (await service.institutionStudents(actor)).find((x) => x.id === id)
    return { directionId: r?.direction?.id ?? null, graduationYear: r?.graduationYear ?? null }
  }

  it('the institution sees its students without contacts, confirms or rejects; another institution cannot', async () => {
    const s = await setup('st-confirm')
    await TenantContext.forTenant(s.tenantId, async () => {
      const me = await s.student()
      await service.save(s.tenantId, me, s.studying() as never)
      const list = await service.institutionStudents(s.approved.actor!)
      expect(list).toEqual([expect.objectContaining({ id: me.id, name: 'Aziz Karimov', course: 2, confirmation: 'PENDING' })])
      expect(Object.keys(list[0]).sort()).toEqual(['confirmation', 'course', 'direction', 'graduationYear', 'id', 'name'])
      await expect(service.decideStudy(s.tenantId, s.other.actor!, me.id, true, await seenBy(s.approved.actor!, me.id))).rejects.toMatchObject({ code: 'not_found' })
      sent.length = 0
      expect((await service.decideStudy(s.tenantId, s.approved.actor!, me.id, true, await seenBy(s.approved.actor!, me.id)))[0].confirmation).toBe('CONFIRMED')
      expect(sent).toEqual([expect.objectContaining({ type: 'student.studyConfirmed', userIds: [me.id] })])
      expect((await service.questionnaire(me)).studyConfirmed).toBe('CONFIRMED')
      // Saving again at the same institution keeps the confirmation; moving to another starts over.
      expect((await service.save(s.tenantId, me, s.studying({ about: 'Python, SQL' }) as never)).studyConfirmed).toBe('CONFIRMED')
      expect((await service.save(s.tenantId, me, s.studying({ institution: { id: s.other.row.id, name: s.other.row.name, region: 'tashkent-city' } }) as never)).studyConfirmed).toBe('PENDING')
      expect(await service.institutionStudents(s.approved.actor!)).toEqual([])
      // An institution not in ILMORA yet has nobody to confirm.
      expect((await service.save(s.tenantId, me, s.studying({ institution: { id: s.unclaimed.row.id, name: s.unclaimed.row.name, region: 'tashkent-city' } }) as never)).studyConfirmed).toBeNull()
    })
  })

  it('Н-8: the institution confirms what it saw — a direction or year changed after the list was read gives 409', async () => {
    const s = await setup('st-seen')
    await TenantContext.forTenant(s.tenantId, async () => {
      const other = await ctx.prisma.client.direction.create({ data: { tenantId: s.tenantId, name: 'Kiberxavfsizlik', searchKey: registrySearchKey('Kiberxavfsizlik'), industryId: s.it.id } })
      const me = await s.student()
      await service.save(s.tenantId, me, s.studying() as never)
      const seen = await seenBy(s.approved.actor!, me.id)
      // Meanwhile the student moves to another direction, then another year.
      await service.save(s.tenantId, me, s.studying({ direction: { id: other.id, name: 'Kiberxavfsizlik' } }) as never)
      await expect(service.decideStudy(s.tenantId, s.approved.actor!, me.id, true, seen)).rejects.toMatchObject({ code: 'study_changed', status: 409 })
      await expect(service.decideStudy(s.tenantId, s.approved.actor!, me.id, false, { ...seen, graduationYear: Y + 5 })).rejects.toMatchObject({ code: 'study_changed' })
      expect((await service.questionnaire(me)).studyConfirmed).toBe('PENDING')
      // The list read again: what it shows now is confirmed.
      expect((await service.decideStudy(s.tenantId, s.approved.actor!, me.id, true, await seenBy(s.approved.actor!, me.id)))[0].confirmation).toBe('CONFIRMED')
      // The list shows the main direction of an alias: that is what the institution saw.
      await ctx.prisma.client.direction.update({ where: { id: other.id }, data: { mergedIntoId: s.dasturlash.id } })
      expect((await service.decideStudy(s.tenantId, s.approved.actor!, me.id, false, { directionId: s.dasturlash.id, graduationYear: seen.graduationYear }))[0].confirmation).toBe('REJECTED')
    })
  })

  it('what the institution confirmed — name, direction, year — changed: «ждёт» again (security review №14)', async () => {
    const s = await setup('st-reconfirm')
    await TenantContext.forTenant(s.tenantId, async () => {
      const other = await ctx.prisma.client.direction.create({ data: { tenantId: s.tenantId, name: 'Kiberxavfsizlik', searchKey: registrySearchKey('Kiberxavfsizlik'), industryId: s.it.id } })
      for (const change of [{ fullName: 'Boşqa Odam' }, { direction: { id: other.id, name: 'Kiberxavfsizlik' } }, { graduationYear: Y + 2 }]) {
        const me = await s.student()
        await service.save(s.tenantId, me, s.studying() as never)
        await service.decideStudy(s.tenantId, s.approved.actor!, me.id, true, await seenBy(s.approved.actor!, me.id))
        expect((await service.save(s.tenantId, me, s.studying({ fullName: ' Aziz   Karimov ', about: 'Yangi' }) as never)).studyConfirmed).toBe('CONFIRMED')
        expect((await service.save(s.tenantId, me, s.studying(change) as never)).studyConfirmed).toBe('PENDING')
      }
      // A rejected student who fixes the questionnaire is asked about again.
      const me = await s.student()
      await service.save(s.tenantId, me, s.studying() as never)
      await service.decideStudy(s.tenantId, s.approved.actor!, me.id, false, await seenBy(s.approved.actor!, me.id))
      expect((await service.save(s.tenantId, me, s.studying({ graduationYear: Y + 2 }) as never)).studyConfirmed).toBe('PENDING')
    })
  })
})
