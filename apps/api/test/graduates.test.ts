import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registrySearchKey } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { APPROVED_KEY } from '../src/common/registry-access'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { CompanyContactsController, StudentContactsController } from '../src/modules/contacts/contacts.controller'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import { CompanyAnnouncementsController, InstitutionAnnouncementsController } from '../src/modules/graduates/graduates.controller'
import { AnnouncementInput, ResponseInput } from '../src/modules/graduates/graduates.schemas'
import { GraduatesService } from '../src/modules/graduates/graduates.service'
import type { NotifyInput, NotificationsService } from '../src/modules/notifications/notifications.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'

const YEAR = new Date().getUTCFullYear()

describe('Graduation announcements: access and input', () => {
  it('institution and company routes need the role and an approved organization; students decide their own requests', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InstitutionAnnouncementsController)).toEqual(['INSTITUTION_ADMIN'])
    expect(Reflect.getMetadata(APPROVED_KEY, InstitutionAnnouncementsController)).toBe('institution')
    for (const c of [CompanyAnnouncementsController, CompanyContactsController]) {
      expect(Reflect.getMetadata(ROLES_KEY, c)).toEqual(['COMPANY_ADMIN'])
      expect(Reflect.getMetadata(APPROVED_KEY, c)).toBe('company')
    }
    expect(Reflect.getMetadata(ROLES_KEY, StudentContactsController)).toEqual(['STUDENT'])
  })

  it('takes a year from last year to 6 ahead, counts > 0, no markup, no status', () => {
    const ann = new ZodValidationPipe(AnnouncementInput)
    expect(ann.transform({ year: YEAR, lines: [{ directionId: 'd', count: 40 }] })).toMatchObject({ year: YEAR })
    for (const bad of [{ year: YEAR - 2 }, { year: YEAR + 7 }, { lines: [] }, { lines: [{ directionId: 'd', count: 0 }] }, { status: 'PUBLISHED' }]) {
      expect(() => ann.transform({ year: YEAR, lines: [{ directionId: 'd', count: 40 }], ...bad })).toThrow()
    }
    const res = new ZodValidationPipe(ResponseInput)
    expect(res.transform({ lines: [{ lineId: 'l', wantedCount: 3 }], comment: '  ' })).toMatchObject({ comment: null })
    expect(() => res.transform({ lines: [{ lineId: 'l', wantedCount: 3 }], comment: '<script>' })).toThrow()
    expect(() => res.transform({ lines: [{ lineId: 'l', wantedCount: 3 }], status: 'ACCEPTED' })).toThrow()
  })
})

describe.skipIf(!DB_AVAILABLE)('Graduation announcements and contact requests (ТЗ 5.1, 8)', () => {
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
  const contacts = new ContactsService(ctx.prisma, ctx.audit, notifications, new MemoryDocs())
  const service = new GraduatesService(ctx.prisma, ctx.audit, notifications, contacts)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /**
   * An approved institution with an IT and a furniture direction; IT, furniture and unapproved companies; students of
   * the IT direction graduating this year — with consent, without it, unconfirmed, another year.
   */
  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    await TenantContext.system(() => seedRegistryReference(db as never, t.tenantId))
    return inT(async () => {
      const tenantId = t.tenantId
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const furniture = await db.industry.findFirstOrThrow({ where: { slug: 'furniture' } })
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const dir = (name: string, industryId: string) => db.direction.create({ data: { tenantId, name, searchKey: registrySearchKey(name), industryId } })
      const dasturlash = await dir('Dasturlaş', it.id)
      const mebel = await dir('Mebel işlab çiqariş', furniture.id)
      const foreign = await dir('Kiberxavfsizlik', it.id)
      let n = 0
      const user = (roles: ('INSTITUTION_ADMIN' | 'COMPANY_ADMIN')[], link: object) =>
        db.user.create({ data: { tenantId, login: `u-${label}-${++n}`, displayName: `Rep ${n}`, jobTitle: 'Direktor', email: `rep${n}@test.uz`, roles, ...link } })
      const inst = await db.institution.create({
        data: { tenantId, type: 'TECHNIKUM', name: 'IT texnikumi', searchKey: registrySearchKey('IT texnikumi'), regionId: tashkent.id, source: 'SELF', status: 'APPROVED', approvedAt: new Date(), phone: '+998901112233', email: 'tex@tex.uz', address: 'Manzil' },
      })
      for (const d of [dasturlash, mebel]) await db.institutionDirection.create({ data: { tenantId, institutionId: inst.id, directionId: d.id, studentsCount: 100 } })
      const instUser = await user(['INSTITUTION_ADMIN'], { institutionId: inst.id })
      const company = async (name: string, stir: string, industryId: string, approved = true) => {
        const row = await db.company.create({ data: { tenantId, stir, name, searchKey: registrySearchKey(name), status: approved ? 'APPROVED' : 'PENDING', approvedAt: approved ? new Date() : null, website: `https://${stir}.uz`, address: 'Ofis', regionId: tashkent.id } })
        await db.companyIndustry.create({ data: { companyId: row.id, industryId } })
        const u = await user(['COMPANY_ADMIN'], { companyId: row.id })
        return { row, actor: { id: u.id, roles: ['COMPANY_ADMIN'] } as RequestActor }
      }
      const student = async (name: string, o: { consent?: boolean; confirmed?: boolean; year?: number; directionId?: string; phone?: string } = {}) => {
        const u = await db.user.create({ data: { tenantId, phoneE164: `+99890${String(++n).padStart(3, '0')}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`, phoneVerifiedAt: new Date(), email: `s${n}@mail.uz`, displayName: name, roles: ['STUDENT'] } })
        await db.studentProfile.create({
          data: {
            tenantId, userId: u.id, mode: 'STUDYING', institutionType: 'TECHNIKUM', institutionId: inst.id, course: 3, graduationYear: o.year ?? YEAR, directionId: o.directionId ?? dasturlash.id,
            regionId: tashkent.id, about: 'Python, SQL', contactPhone: o.phone ?? null, studyConfirmation: o.confirmed === false ? 'PENDING' : 'CONFIRMED',
          },
        })
        if (o.consent !== false) await db.studentConsent.create({ data: { tenantId, userId: u.id, kind: 'GRADUATE_CARD', textVersion: 'v1' } })
        return { id: u.id, roles: ['STUDENT'] } as RequestActor
      }
      return {
        tenantId, inT, it, furniture, dasturlash, mebel, foreign, inst,
        instActor: { id: instUser.id, roles: ['INSTITUTION_ADMIN'] } as RequestActor,
        softCo: await company('Soft Co', '401111111', it.id),
        mebelCo: await company('Mebel Co', '402222222', furniture.id),
        pendingCo: await company('Yangi Co', '403333333', it.id, false),
        aziz: await student('Aziz', { phone: '+998935554433' }),
        bobur: await student('Bobur'),
        noConsent: await student('Davron', { consent: false }),
        unconfirmed: await student('Eldor', { confirmed: false }),
        nextYear: await student('Farrux', { year: YEAR + 1 }),
      }
    })
  }

  const published = async (s: Awaited<ReturnType<typeof setup>>) => {
    const draft = await service.create(s.tenantId, s.instActor, { year: YEAR, lines: [{ directionId: s.dasturlash.id, count: 40 }, { directionId: s.mebel.id, count: 25 }] })
    return service.publish(s.tenantId, s.instActor, draft.id)
  }

  it('the institution announces its own directions, publishes and closes; the IT and furniture companies are notified once each', async () => {
    const s = await setup('gr-flow')
    await s.inT(async () => {
      await expect(service.create(s.tenantId, s.instActor, { year: YEAR, lines: [{ directionId: s.foreign.id, count: 5 }] })).rejects.toMatchObject({ code: 'invalid_direction' })
      await expect(service.create(s.tenantId, s.instActor, { year: YEAR, lines: [{ directionId: s.dasturlash.id, count: 5 }, { directionId: s.dasturlash.id, count: 3 }] })).rejects.toMatchObject({ code: 'direction_listed_twice' })
      sent.length = 0
      const draft = await service.create(s.tenantId, s.instActor, { year: YEAR, lines: [{ directionId: s.dasturlash.id, count: 40 }] })
      expect(draft).toMatchObject({ status: 'DRAFT', total: 40, responses: { pending: 0, accepted: 0 } })
      // In the number all graduate; in the list only confirmed students of that year with consent.
      expect(draft.lines[0].students.map((x) => x.name)).toEqual(['Aziz', 'Bobur'])
      expect(sent).toEqual([])
      expect(await service.companyList(s.softCo.actor, {})).toEqual([])

      const pub = await service.publish(s.tenantId, s.instActor, draft.id)
      expect(pub.status).toBe('PUBLISHED')
      expect(sent).toEqual([expect.objectContaining({ type: 'announcement.published', userIds: [s.softCo.actor.id], dedupeKey: `announcement:${draft.id}`, params: expect.objectContaining({ institutionName: 'IT texnikumi', year: YEAR }) })])
      await expect(service.publish(s.tenantId, s.instActor, draft.id)).rejects.toMatchObject({ code: 'announcement_not_draft' })

      // A new furniture line: the furniture company is told; the same dedupe key keeps Soft Co from a second notice.
      sent.length = 0
      await service.updateLines(s.tenantId, s.instActor, draft.id, { lines: [{ directionId: s.dasturlash.id, count: 45 }, { directionId: s.mebel.id, count: 25 }] })
      expect(sent[0]).toMatchObject({ dedupeKey: `announcement:${draft.id}` })
      expect(sent[0].userIds.sort()).toEqual([s.softCo.actor.id, s.mebelCo.actor.id].sort())

      expect((await service.close(s.instActor, draft.id)).status).toBe('CLOSED')
      await expect(service.updateLines(s.tenantId, s.instActor, draft.id, { lines: [{ directionId: s.dasturlash.id, count: 1 }] })).rejects.toMatchObject({ code: 'announcement_closed' })
      await expect(service.close(s.instActor, draft.id)).rejects.toMatchObject({ code: 'announcement_not_published' })
      await expect(service.companyGet(s.softCo.actor, draft.id)).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('a company sees only the lines of its industries and the cards without contacts; excluded and revoked cards go', async () => {
    const s = await setup('gr-see')
    await s.inT(async () => {
      const ann = await published(s)
      const [listed] = await service.companyList(s.softCo.actor, {})
      expect(listed).toMatchObject({ id: ann.id, total: 40, institution: { name: 'IT texnikumi' }, myResponse: null })
      expect(listed.lines.map((l) => l.direction.id)).toEqual([s.dasturlash.id])
      expect(listed.graduates).toBeUndefined()
      expect(await service.companyList(s.softCo.actor, { year: YEAR + 1 })).toEqual([])

      const seen = await service.companyGet(s.softCo.actor, ann.id)
      expect(seen.graduates!.map((g) => g.name)).toEqual(['Aziz', 'Bobur'])
      expect(seen.graduates![0]).toMatchObject({ institution: 'IT texnikumi', graduationYear: YEAR, about: 'Python, SQL', studyConfirmed: true, contactRequest: null })
      const text = JSON.stringify(seen)
      for (const secret of ['+998935554433', '@mail.uz', '+998901112233', 'tex@tex.uz']) expect(text).not.toContain(secret)

      // The furniture company sees only the furniture line, with no IT students (an unapproved one is stopped by the guard).
      const mebel = await service.companyGet(s.mebelCo.actor, ann.id)
      expect(mebel.lines.map((l) => l.direction.id)).toEqual([s.mebel.id])
      expect(mebel.graduates).toEqual([])

      await service.setExcluded(s.instActor, ann.id, s.bobur.id, true)
      expect((await service.get(s.instActor, ann.id)).lines[0].students.find((x) => x.studentId === s.bobur.id)?.excluded).toBe(true)
      expect((await service.companyGet(s.softCo.actor, ann.id)).graduates!.map((g) => g.name)).toEqual(['Aziz'])
      await service.setExcluded(s.instActor, ann.id, s.bobur.id, false)
      await ctx.prisma.client.studentConsent.updateMany({ where: { userId: s.aziz.id, kind: 'GRADUATE_CARD' }, data: { revokedAt: new Date() } })
      expect((await service.companyGet(s.softCo.actor, ann.id)).graduates!.map((g) => g.name)).toEqual(['Bobur'])
      await expect(service.setExcluded(s.instActor, ann.id, s.softCo.actor.id, true)).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('an answer on visible lines → the institution accepts → contacts open both ways', async () => {
    const s = await setup('gr-respond')
    await s.inT(async () => {
      const ann = await published(s)
      const view = await service.companyGet(s.mebelCo.actor, ann.id)
      const mebelLine = view.lines[0].id
      await expect(service.respond(s.tenantId, s.softCo.actor, ann.id, { lines: [{ lineId: mebelLine, wantedCount: 3 }] })).rejects.toMatchObject({ code: 'invalid_line' })
      const itLine = (await service.companyGet(s.softCo.actor, ann.id)).lines[0].id
      sent.length = 0
      const answered = await service.respond(s.tenantId, s.softCo.actor, ann.id, { lines: [{ lineId: itLine, wantedCount: 3 }], comment: 'Python' })
      expect(answered.myResponse).toMatchObject({ status: 'PENDING', comment: 'Python', lines: [{ lineId: itLine, wantedCount: 3 }], contacts: null })
      expect(sent).toEqual([expect.objectContaining({ type: 'announcement.response', userIds: [s.instActor.id], params: expect.objectContaining({ companyName: 'Soft Co' }) })])
      await expect(service.respond(s.tenantId, s.softCo.actor, ann.id, { lines: [{ lineId: itLine, wantedCount: 1 }] })).rejects.toMatchObject({ code: 'response_exists' })

      const [r] = await service.responses(s.instActor, ann.id)
      expect(r).toMatchObject({ status: 'PENDING', contacts: null, company: { name: 'Soft Co' } })
      expect(JSON.stringify(r)).not.toContain('401111111.uz')
      sent.length = 0
      const [accepted] = await service.decideResponse(s.tenantId, s.instActor, r.id, true)
      expect(accepted.contacts).toMatchObject({ website: 'https://401111111.uz', email: expect.stringContaining('@test.uz') })
      expect(sent).toEqual([expect.objectContaining({ type: 'announcement.responseAccepted', userIds: [s.softCo.actor.id] })])
      await expect(service.decideResponse(s.tenantId, s.instActor, r.id, false)).rejects.toMatchObject({ code: 'response_decided' })
      expect((await service.companyGet(s.softCo.actor, ann.id)).myResponse!.contacts).toMatchObject({ phone: '+998901112233', email: 'tex@tex.uz' })
      expect((await service.get(s.instActor, ann.id)).responses).toEqual({ pending: 0, accepted: 1 })
    })
  })

  it('invite → the student accepts → the full card with the contact phone, every view audited; one request per company', async () => {
    const s = await setup('gr-invite')
    await s.inT(async () => {
      const ann = await published(s)
      await expect(service.invite(s.tenantId, s.softCo.actor, s.noConsent.id, ann.id)).rejects.toMatchObject({ code: 'not_found' })
      await expect(service.invite(s.tenantId, s.mebelCo.actor, s.aziz.id, ann.id)).rejects.toMatchObject({ code: 'not_found' })
      sent.length = 0
      const after = await service.invite(s.tenantId, s.softCo.actor, s.aziz.id, ann.id)
      expect(after.graduates!.find((g) => g.studentId === s.aziz.id)?.contactRequest).toBe('PENDING')
      expect(sent).toEqual([expect.objectContaining({ type: 'contact.request', userIds: [s.aziz.id], params: expect.objectContaining({ companyName: 'Soft Co' }) })])
      await expect(service.invite(s.tenantId, s.softCo.actor, s.aziz.id, ann.id)).rejects.toMatchObject({ code: 'contact_request_exists' })

      const [req] = await contacts.studentList(s.aziz)
      expect(req).toMatchObject({ source: 'GRADUATE', status: 'PENDING', company: { name: 'Soft Co', website: 'https://401111111.uz' } })
      const [pending] = await contacts.companyList(s.softCo.actor)
      expect(pending).toMatchObject({ status: 'PENDING', student: { name: 'Aziz', full: null } })
      expect((await contacts.companyContact(s.softCo.actor, req.id)).student.full).toBeNull()
      await expect(contacts.decide(s.tenantId, s.bobur, req.id, true)).rejects.toMatchObject({ code: 'not_found' })

      const cert = await ctx.prisma.client.studentCertificate.create({ data: { tenantId: s.tenantId, userId: s.aziz.id, title: 'IELTS 7.0', fileKey: `student-certs/${s.tenantId}/${s.aziz.id}/1.pdf`, contentType: 'application/pdf', sizeBytes: 100 } })
      await expect(contacts.certificateLink(s.softCo.actor, req.id, cert.id)).rejects.toMatchObject({ code: 'not_found' })
      sent.length = 0
      expect((await contacts.decide(s.tenantId, s.aziz, req.id, true, '10.0.0.1'))[0].status).toBe('ACCEPTED')
      expect(sent).toEqual([expect.objectContaining({ type: 'contact.accepted', userIds: [s.softCo.actor.id], params: expect.objectContaining({ studentName: 'Aziz' }) })])
      expect(await ctx.prisma.client.studentConsent.findMany({ where: { userId: s.aziz.id, kind: 'COMPANY_CONTACTS' }, select: { companyId: true, ip: true, revokedAt: true } })).toEqual([{ companyId: s.softCo.row.id, ip: '10.0.0.1', revokedAt: null }])
      await expect(contacts.decide(s.tenantId, s.aziz, req.id, false)).rejects.toMatchObject({ code: 'contact_request_decided' })

      const open = await contacts.companyContact(s.softCo.actor, req.id)
      expect(open.student.full).toMatchObject({ name: 'Aziz', phone: '+998935554433', email: expect.stringContaining('@mail.uz'), institution: 'IT texnikumi', graduationYear: YEAR, certificates: [expect.objectContaining({ title: 'IELTS 7.0' })] })
      expect((await contacts.certificateLink(s.softCo.actor, req.id, cert.id)).url).toContain(cert.fileKey)
      // Another company sees neither the request nor the file.
      await expect(contacts.companyContact(s.mebelCo.actor, req.id)).rejects.toMatchObject({ code: 'not_found' })
      await expect(contacts.certificateLink(s.mebelCo.actor, req.id, cert.id)).rejects.toMatchObject({ code: 'not_found' })
      const audited = await ctx.prisma.client.auditEvent.findMany({ where: { action: { in: ['contact.view', 'contact.certificate.download'] }, entityId: { in: [s.aziz.id, cert.id] } }, select: { action: true } })
      expect(audited.map((a) => a.action).sort()).toEqual(['contact.certificate.download', 'contact.view'])
    })
  })

  it('a declined request stays declined and is not sent again; without a contact phone the SMS number is shown', async () => {
    const s = await setup('gr-decline')
    await s.inT(async () => {
      const ann = await published(s)
      await service.invite(s.tenantId, s.softCo.actor, s.bobur.id, ann.id)
      const [req] = await contacts.studentList(s.bobur)
      sent.length = 0
      await contacts.decide(s.tenantId, s.bobur, req.id, false)
      expect(sent).toEqual([expect.objectContaining({ type: 'contact.declined', params: expect.objectContaining({ studentName: '' }) })])
      expect((await service.companyGet(s.softCo.actor, ann.id)).graduates!.find((g) => g.studentId === s.bobur.id)?.contactRequest).toBe('DECLINED')
      await expect(service.invite(s.tenantId, s.softCo.actor, s.bobur.id, ann.id)).rejects.toMatchObject({ code: 'contact_request_exists' })
      expect((await contacts.companyContact(s.softCo.actor, req.id)).student.full).toBeNull()
      const phone = (await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: s.bobur.id }, select: { phoneE164: true } })).phoneE164
      expect((await contacts.fullCard(s.bobur.id)).phone).toBe(phone)
    })
  })
})
