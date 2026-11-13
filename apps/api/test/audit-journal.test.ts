import { registrySearchKey } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedRegistryReference } from '../prisma/registry-reference'
import type { Env } from '../src/config/env'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { type AuditInput, AuditService } from '../src/modules/audit/audit.service'
import { CONTACT_REQUESTS_PER_DAY, ContactsService } from '../src/modules/contacts/contacts.service'
import { CompanyStudentsService } from '../src/modules/graduates/company-students.service'
import { AuditQuery } from '../src/modules/manage/manage.controller'
import { ManageService } from '../src/modules/manage/manage.service'
import type { NotificationsService, NotifyInput } from '../src/modules/notifications/notifications.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { lockConsents } from '../src/modules/students/students.service'
import { ageAudit, DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'

const superAdmin: RequestActor = { id: 'sa', roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] }
const finance: RequestActor = { id: 'fin', roles: ['FINANCE_ADMIN'] }
const FINANCE_ENTITIES = ['Payment', 'Subscription', 'RefundRequest']

/** ТЗ 8, «Студенты у компании» 7: the audit log read by the Super Admin — the filters and what a finance admin keeps seeing. */
describe('Audit log: filters', () => {
  it('the query: a period by moment or by Tashkent day (the last day included); anything else is refused', () => {
    const pipe = new ZodValidationPipe(AuditQuery)
    expect(pipe.transform({ entityType: 'User', entityId: 'u1', action: 'student.card.view', actorId: 'a1', companyId: 'c1', page: '2', pageSize: 'x' }))
      .toEqual({ entityType: 'User', entityId: 'u1', action: 'student.card.view', actorId: 'a1', companyId: 'c1', page: '2', pageSize: 'x' })
    // Tashkent is UTC+5: the day 10 November runs from 19:00 UTC on the 9th to 19:00 UTC on the 10th.
    expect(pipe.transform({ from: '2026-11-10', to: '2026-11-10' })).toEqual({ from: new Date('2026-11-09T19:00:00.000Z'), to: new Date('2026-11-10T19:00:00.000Z') })
    expect(pipe.transform({ from: '2026-11-10T08:30:00+05:00', to: '2026-11-10T04:00:00Z' })).toEqual({ from: new Date('2026-11-10T03:30:00.000Z'), to: new Date('2026-11-10T04:00:00.000Z') })
    for (const bad of [{ from: 'yesterday' }, { to: '2026-02-30' }, { from: '2026-11-10T08:30:00' }, { action: ['a', 'b'] }, { companyId: 'x'.repeat(201) }]) expect(() => pipe.transform(bad)).toThrow()
  })

  const setup = () => {
    const wheres: unknown[] = []
    const raws: { sql: string; params: unknown[] }[] = []
    const client = {
      auditEvent: { findMany: async ({ where }: { where: unknown }) => (wheres.push(where), []), count: async () => 0 },
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => (raws.push({ sql, params }), sql.startsWith('SELECT count') ? [{ n: 0 }] : []),
    }
    const service = new ManageService({ client } as unknown as PrismaService, {} as unknown as AuditService, {} as unknown as SessionsService, {} as unknown as SiteService, notificationsStub, {} as unknown as Env)
    return { service, wheres, raws }
  }

  it('the Super Admin filters by action, actor and period', async () => {
    const { service, wheres } = setup()
    const from = new Date('2026-11-01T00:00:00Z'), to = new Date('2026-11-08T00:00:00Z')
    await service.audits('t', superAdmin, { action: 'student.card.view', actorId: 'rep', from, to })
    await service.audits('t', superAdmin, { entityType: 'User', entityId: 'student', from })
    expect(wheres).toEqual([
      { tenantId: 't', action: 'student.card.view', actorId: 'rep', createdAt: { gte: from, lt: to } },
      { tenantId: 't', entityType: 'User', entityId: 'student', createdAt: { gte: from } },
    ])
  })

  it('a finance admin with the new filters still reads the money records only', async () => {
    const { service, wheres, raws } = setup()
    await service.audits('t', finance, { action: 'student.card.view', actorId: 'rep', from: new Date('2026-11-01T00:00:00Z') })
    expect(wheres).toEqual([{ tenantId: 't', entityType: { in: FINANCE_ENTITIES }, action: 'student.card.view', actorId: 'rep', createdAt: { gte: new Date('2026-11-01T00:00:00Z') } }])
    // By company: the same fence in the SQL of the company filter.
    await service.audits('t', finance, { companyId: 'co' })
    expect(raws).toHaveLength(2)
    for (const r of raws) {
      expect(r.sql).toContain(`"tenantId" = $1 AND ("after"->>'companyId') = $2 AND "entityType" = ANY($3::text[])`)
      expect(r.params).toEqual(['t', 'co', FINANCE_ENTITIES])
    }
    // Another entity type: nothing is read at all, whatever else is asked.
    expect(await service.audits('t', finance, { entityType: 'User', entityId: 'student', companyId: 'co', action: 'student.card.view' })).toMatchObject({ total: 0, items: [] })
    expect(raws).toHaveLength(2)
    expect(wheres).toHaveLength(1)
  })

  it('the Super Admin by company: every filter is a bound parameter', async () => {
    const { service, raws } = setup()
    await service.audits('t', superAdmin, { companyId: `co' OR 1=1 --`, entityType: 'User', entityId: 'student', action: 'student.card.view', actorId: 'rep', from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-08T00:00:00Z'), page: 3, pageSize: 20 })
    expect(raws[1].sql).toBe(`SELECT "id" FROM "AuditEvent" WHERE "tenantId" = $1 AND ("after"->>'companyId') = $2 AND "entityType" = $3 AND "entityId" = $4 AND "action" = $5 AND "actorId" = $6 AND "createdAt" >= $7::timestamp AND "createdAt" < $8::timestamp ORDER BY "createdAt" DESC, "id" DESC LIMIT 20 OFFSET 40`)
    expect(raws[1].params).toEqual(['t', `co' OR 1=1 --`, 'User', 'student', 'student.card.view', 'rep', '2026-11-01T00:00:00.000Z', '2026-11-08T00:00:00.000Z'])
  })
})

describe.skipIf(!DB_AVAILABLE)('Audit log: written with the action, append-only, read by filters', () => {
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
  /** The audit log that can be made to fail on one action — «the row could not be written». */
  class FailingAudit extends AuditService {
    failOn: string | null = null
    override async record(input: AuditInput) {
      if (input.action === this.failOn) throw new Error('audit down')
      return super.record(input)
    }
  }
  const audit = new FailingAudit(ctx.prisma)
  const contacts = new ContactsService(ctx.prisma, audit, notifications, new MemoryDocs())
  const section = new CompanyStudentsService(ctx.prisma, audit, contacts, ctx.env)
  const manage = new ManageService(ctx.prisma, ctx.audit, {} as unknown as SessionsService, {} as unknown as SiteService, notificationsStub, ctx.env)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const tenantId = t.tenantId
    await TenantContext.system(() => seedRegistryReference(db as never, tenantId))
    return TenantContext.forTenant(tenantId, async () => {
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const direction = await db.direction.create({ data: { tenantId, name: 'Dasturlaş', searchKey: registrySearchKey('Dasturlaş'), industryId: it.id } })
      const institution = await db.institution.create({ data: { tenantId, type: 'COLLEGE', name: 'Toşkent kolleji', searchKey: registrySearchKey('Toşkent kolleji'), regionId: tashkent.id, source: 'IMPORT', status: 'APPROVED', approvedAt: new Date() } })
      let n = 0
      const company = async (name: string, stir: string) => {
        const row = await db.company.create({ data: { tenantId, stir, name, searchKey: registrySearchKey(name), status: 'APPROVED', approvedAt: new Date(), regionId: tashkent.id } })
        await db.companyIndustry.create({ data: { companyId: row.id, industryId: it.id } })
        const u = await db.user.create({ data: { tenantId, login: `rep-${label}-${++n}`, displayName: `Rep ${name}`, roles: ['COMPANY_ADMIN'], companyId: row.id } })
        return { row, actor: { id: u.id, roles: ['COMPANY_ADMIN'] } as RequestActor }
      }
      /** A student the «Студенты» section shows: studying, confirmed, an adult, with the consent in force. */
      const student = async (name: string) => {
        const u = await db.user.create({ data: { tenantId, displayName: name, phoneE164: `+99890${String(++n).padStart(3, '0')}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`, phoneVerifiedAt: new Date(), email: `s${n}@mail.uz`, roles: ['STUDENT'] } })
        await db.studentProfile.create({ data: { tenantId, userId: u.id, mode: 'STUDYING', institutionType: 'COLLEGE', institutionId: institution.id, course: 2, graduationYear: new Date().getUTCFullYear() + 2, directionId: direction.id, birthDate: new Date(`${new Date().getUTCFullYear() - 20}-05-01T00:00:00Z`), regionId: tashkent.id, studyConfirmation: 'CONFIRMED' } })
        await db.studentConsent.create({ data: { tenantId, userId: u.id, kind: 'INDUSTRY_CARD', textVersion: 'v1' } })
        return { id: u.id, roles: ['STUDENT'] } as RequestActor
      }
      const softCo = await company('Soft Co', '401111111')
      const dataCo = await company('Data Co', '403333333')
      const cardId = async (name: string, co = softCo) => (await section.page(co.actor, institution.id, {}, 1)).items.find((c) => c.name === name)!.cardId
      const ask = async (name: string, co = softCo) => section.request(tenantId, co.actor, institution.id, await cardId(name, co))
      return { tenantId, db, institution, softCo, dataCo, student, cardId, ask, inT: <T>(fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn) }
    })
  }
  const events = (db: TestContext['prisma']['client'], action: string) => db.auditEvent.findMany({ where: { action }, orderBy: { createdAt: 'asc' }, select: { entityType: true, entityId: true, after: true } })

  it('no audit row — no action: a failed write undoes the contact request, the acceptance and the refusal', async () => {
    const s = await setup('aj-atomic')
    await s.inT(async () => {
      const aziz = await s.student('Aziz')
      sent.length = 0
      audit.failOn = 'contact.request'
      try {
        await expect(s.ask('Aziz')).rejects.toThrow('audit down')
        expect(await s.db.contactRequest.count({ where: { userId: aziz.id } })).toBe(0)
        expect(sent).toEqual([])

        audit.failOn = null
        expect(await s.ask('Aziz')).toMatchObject({ contactRequest: 'PENDING' })
        const req = await s.db.contactRequest.findFirstOrThrow({ where: { userId: aziz.id } })
        sent.length = 0
        for (const [action, accept] of [['contact.accept', true], ['contact.decline', false]] as const) {
          audit.failOn = action
          await expect(contacts.decide(s.tenantId, aziz, req.id, accept)).rejects.toThrow('audit down')
          expect(await s.db.contactRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'PENDING', decidedAt: null, sharedName: null })
          expect(await s.db.studentConsent.count({ where: { userId: aziz.id, kind: 'COMPANY_CONTACTS' } })).toBe(0)
        }
        expect(sent).toEqual([])
        expect(await s.db.auditEvent.count({ where: { action: { in: ['contact.accept', 'contact.decline'] } } })).toBe(0)
        // The company still has no contacts.
        await expect(contacts.companyContact(s.softCo.actor, req.id)).rejects.toMatchObject({ code: 'not_found' })
      } finally {
        audit.failOn = null
      }
    })
  })

  it('«Студенты»: request → accept → two views → a certificate file, each in the log with the company and the student', async () => {
    const s = await setup('aj-chain')
    await s.inT(async () => {
      const aziz = await s.student('Aziz')
      const bobur = await s.student('Bobur')
      const companyId = s.softCo.row.id
      await s.ask('Aziz')
      const req = await s.db.contactRequest.findFirstOrThrow({ where: { userId: aziz.id, companyId } })
      expect(req.source).toBe('STUDENTS')
      expect(await events(s.db, 'contact.request')).toEqual([{ entityType: 'ContactRequest', entityId: req.id, after: { companyId, userId: aziz.id, source: 'STUDENTS' } }])

      const cert = await s.db.studentCertificate.create({ data: { tenantId: s.tenantId, userId: aziz.id, title: 'IELTS 7.0', fileKey: `student-certs/${s.tenantId}/${aziz.id}/1.pdf`, contentType: 'application/pdf', sizeBytes: 100 } })
      expect((await contacts.decide(s.tenantId, aziz, req.id, true, '10.0.0.1'))[0].status).toBe('ACCEPTED')
      expect(await events(s.db, 'contact.accept')).toEqual([{ entityType: 'ContactRequest', entityId: req.id, after: { companyId, userId: aziz.id } }])

      for (let i = 0; i < 2; i++) expect((await contacts.companyContact(s.softCo.actor, req.id)).student).toMatchObject({ id: aziz.id, name: 'Aziz' })
      expect(await events(s.db, 'contact.view')).toEqual(Array.from({ length: 2 }, () => ({ entityType: 'User', entityId: aziz.id, after: { companyId, requestId: req.id } })))

      expect((await contacts.certificateLink(s.softCo.actor, req.id, cert.id)).url).toContain(cert.fileKey)
      expect(await events(s.db, 'contact.certificate.download')).toEqual([{ entityType: 'StudentCertificate', entityId: cert.id, after: { companyId, userId: aziz.id } }])

      // A refusal names the student too.
      await s.ask('Bobur')
      const declined = await s.db.contactRequest.findFirstOrThrow({ where: { userId: bobur.id, companyId } })
      await contacts.decide(s.tenantId, bobur, declined.id, false)
      expect(await events(s.db, 'contact.decline')).toEqual([{ entityType: 'ContactRequest', entityId: declined.id, after: { companyId, userId: bobur.id } }])

      // What the Super Admin asks the log: who saw Aziz, and what the company did.
      const sawAziz = await manage.audits(s.tenantId, superAdmin, { entityType: 'User', entityId: aziz.id, action: 'contact.view' })
      expect(sawAziz.items.map((e) => [e.action, (e.after as { companyId: string }).companyId])).toEqual([['contact.view', companyId], ['contact.view', companyId]])
      // (The pages of «Студенты» the company opened on the way are there as well: only the contact events are counted here.)
      const byCompany = await manage.audits(s.tenantId, superAdmin, { companyId })
      expect(byCompany.total).toBe(byCompany.items.length)
      expect(byCompany.items.map((e) => e.action).filter((a) => a.startsWith('contact.')).sort()).toEqual(['contact.accept', 'contact.certificate.download', 'contact.decline', 'contact.request', 'contact.request', 'contact.view', 'contact.view'])
      expect((await manage.audits(s.tenantId, superAdmin, { companyId: s.dataCo.row.id })).total).toBe(0)
    })
  })

  it('a consent taken back between the look and the request gives no request (the look is repeated under the consents lock)', async () => {
    const s = await setup('aj-race')
    await s.inT(async () => {
      const aziz = await s.student('Aziz')
      const card = await s.cardId('Aziz')
      // The student's save holds the consents lock and takes the consent back; the company's click arrives before it commits.
      const { clicked } = await ctx.prisma.client.$transaction(async (tx) => {
        await lockConsents(tx, aziz.id)
        await tx.studentConsent.updateMany({ where: { userId: aziz.id, kind: 'INDUSTRY_CARD', revokedAt: null }, data: { revokedAt: new Date() } })
        const clicked = section.request(s.tenantId, s.softCo.actor, s.institution.id, card).then(() => 'sent', (e: { code?: string }) => e.code)
        await new Promise((r) => setTimeout(r, 400))
        return { clicked }
      })
      expect(await clicked).toBe('not_found')
      expect(await s.db.contactRequest.count({ where: { userId: aziz.id } })).toBe(0)
      expect(await s.db.auditEvent.count({ where: { action: 'contact.request' } })).toBe(0)
    })
  })

  it('the database refuses to change or remove an audit row; deleting the actor still clears the link', async () => {
    const s = await setup('aj-append')
    await s.inT(async () => {
      const actor = await s.db.user.create({ data: { tenantId: s.tenantId, login: 'aj-actor', displayName: 'Actor', roles: ['PLATFORM_ADMIN'] } })
      const row = await s.db.auditEvent.create({ data: { tenantId: s.tenantId, actorId: actor.id, actorRoles: ['PLATFORM_ADMIN'], action: 'user.roles', entityType: 'User', entityId: 'someone', after: { roles: ['TEACHER'] }, reason: 'as asked' } })
      const refused = /append-only/
      await expect(s.db.auditEvent.update({ where: { id: row.id }, data: { reason: 'rewritten' } })).rejects.toThrow(refused)
      await expect(s.db.auditEvent.updateMany({ where: { id: row.id }, data: { after: { roles: [] } } })).rejects.toThrow(refused)
      // Taking the actor off a row is the foreign key's business only: not while the account exists.
      await expect(s.db.auditEvent.update({ where: { id: row.id }, data: { actorId: null } })).rejects.toThrow(refused)
      await expect(s.db.auditEvent.delete({ where: { id: row.id } })).rejects.toThrow(refused)
      await expect(s.db.auditEvent.deleteMany({ where: { id: row.id } })).rejects.toThrow(refused)
      await expect(s.db.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "id" = $1`, row.id)).rejects.toThrow(refused)
      expect(await s.db.auditEvent.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row)

      // The account is hard-deleted: the row stays, without its actor, nothing else touched.
      await s.db.user.delete({ where: { id: actor.id }, hardDelete: true } as never)
      expect(await s.db.auditEvent.findUniqueOrThrow({ where: { id: row.id } })).toEqual({ ...row, actorId: null })

      // Maintenance, said in the transaction (the demo purge; here the tests' helper), is let through — and ends with it.
      const old = new Date(Date.now() - 15 * 86_400_000)
      await ageAudit(ctx.prisma, { id: row.id }, old)
      expect((await s.db.auditEvent.findUniqueOrThrow({ where: { id: row.id } })).createdAt).toEqual(old)
      await expect(s.db.auditEvent.updateMany({ where: { id: row.id }, data: { createdAt: new Date() } })).rejects.toThrow(refused)
    })
  })

  it('the log by action, by student, by company and by period; a finance admin keeps to the money records', async () => {
    const s = await setup('aj-filters')
    await s.inT(async () => {
      const student = await s.student('Aziz')
      const a = s.softCo.row.id, b = s.dataCo.row.id
      const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000)
      const put = (action: string, entityType: string, entityId: string, after: object, createdAt: Date, actorId?: string) =>
        s.db.auditEvent.create({ data: { tenantId: s.tenantId, actorId: actorId ?? null, actorRoles: [], action, entityType, entityId, after, createdAt }, select: { id: true } })
      const before = (await manage.audits(s.tenantId, superAdmin, {})).total
      const viewA = await put('student.card.view', 'User', student.id, { companyId: a, institutionId: s.institution.id, page: 1 }, ago(72), s.softCo.actor.id)
      const viewB = await put('student.card.view', 'User', student.id, { companyId: b, institutionId: s.institution.id, page: 1 }, ago(48), s.dataCo.actor.id)
      const request = await put('contact.request', 'ContactRequest', 'r1', { companyId: a, userId: student.id, source: 'STUDENTS' }, ago(24), s.softCo.actor.id)
      const roles = await put('user.roles', 'User', 'someone-else', { roles: ['TEACHER'] }, ago(12))
      const payment = await put('payment.settle', 'Payment', 'p1', { amountMinor: '100' }, ago(6))
      const paymentOfA = await put('payment.refund', 'Payment', 'p2', { companyId: a }, ago(3), s.softCo.actor.id)
      const ids = async (actor: RequestActor, q: Parameters<ManageService['audits']>[2]) => (await manage.audits(s.tenantId, actor, q)).items.map((e) => e.id)

      expect((await manage.audits(s.tenantId, superAdmin, {})).total).toBe(before + 6)
      expect(await ids(superAdmin, { action: 'student.card.view' })).toEqual([viewB.id, viewA.id])
      // «Which companies saw this student's card, and when».
      const saw = await manage.audits(s.tenantId, superAdmin, { entityType: 'User', entityId: student.id })
      expect(saw.items.map((e) => [(e.after as { companyId: string }).companyId, e.actor?.id])).toEqual([[b, s.dataCo.actor.id], [a, s.softCo.actor.id]])
      // «What this company did», newest first, with the actor; then within a period (`from` included, `to` not).
      const ofA = await manage.audits(s.tenantId, superAdmin, { companyId: a })
      expect(ofA).toMatchObject({ total: 3, page: 1 })
      expect(ofA.items.map((e) => e.id)).toEqual([paymentOfA.id, request.id, viewA.id])
      expect(ofA.items[1].actor).toMatchObject({ id: s.softCo.actor.id, displayName: 'Rep Soft Co' })
      expect(await ids(superAdmin, { companyId: a, from: ago(30), to: ago(4) })).toEqual([request.id])
      expect(await ids(superAdmin, { companyId: a, from: ago(24 + 1), to: ago(24 - 1), action: 'contact.request', entityType: 'ContactRequest', entityId: 'r1', actorId: s.softCo.actor.id })).toEqual([request.id])
      expect(await ids(superAdmin, { companyId: a, action: 'student.card.view' })).toEqual([viewA.id])
      expect(await ids(superAdmin, { companyId: a, actorId: s.dataCo.actor.id })).toEqual([])
      expect(await ids(superAdmin, { companyId: 'no-such-company' })).toEqual([])
      expect(await ids(superAdmin, { from: ago(50), to: ago(10) })).toEqual([roles.id, request.id, viewB.id])
      expect(await ids(superAdmin, { actorId: s.dataCo.actor.id })).toEqual([viewB.id])

      // A finance admin: the money records, whatever the filter.
      expect(await ids(finance, {})).toEqual([paymentOfA.id, payment.id])
      expect(await ids(finance, { companyId: a })).toEqual([paymentOfA.id])
      expect(await ids(finance, { companyId: b })).toEqual([])
      expect(await ids(finance, { action: 'student.card.view' })).toEqual([])
      expect(await ids(finance, { actorId: s.softCo.actor.id })).toEqual([paymentOfA.id])
      expect(await ids(finance, { from: ago(80), to: ago(20) })).toEqual([])
      expect(await manage.audits(s.tenantId, finance, { entityType: 'User', entityId: student.id, companyId: a })).toMatchObject({ total: 0, items: [] })
    })
  })

  it('the daily limit with «Студенты»: the 51st request is 429 with the real wait; of two at once at 49 one goes through', async () => {
    const s = await setup('aj-limit')
    await s.inT(async () => {
      const [aziz, bobur] = [await s.student('Aziz'), await s.student('Bobur')]
      const row = (companyId: string, createdAt: Date) => ({ tenantId: s.tenantId, companyId, userId: aziz.id, source: 'CONTRACT_HELP' as const, createdAt })
      const hour = 3_600_000
      // 49 in the last 24 hours — the oldest 20 hours ago — and older ones that no longer count.
      await s.db.contactRequest.createMany({ data: [row(s.softCo.row.id, new Date(Date.now() - 20 * hour)), ...Array.from({ length: CONTACT_REQUESTS_PER_DAY - 2 }, () => row(s.softCo.row.id, new Date(Date.now() - hour)))] })
      await s.db.contactRequest.createMany({ data: Array.from({ length: 30 }, () => row(s.softCo.row.id, new Date(Date.now() - 48 * hour))) })
      expect(await s.ask('Aziz')).toMatchObject({ contactRequest: 'PENDING' })
      const refused = await s.ask('Bobur').then(() => null, (e: { code: string; status: number; details?: { retryAfterSeconds?: number } }) => e)
      expect(refused).toMatchObject({ code: 'rate_limited', status: 429 })
      // Not the old flat hour: until the oldest of the 50 leaves the 24 hours — about 4 hours from now.
      const wait = refused!.details!.retryAfterSeconds!
      expect(wait).toBeLessThanOrEqual(4 * 3600)
      expect(wait).toBeGreaterThan(4 * 3600 - 60)
      expect(await s.db.contactRequest.count({ where: { userId: bobur.id } })).toBe(0)
      expect(await s.db.auditEvent.count({ where: { action: 'contact.request' } })).toBe(1)

      // Two clicks at once with one place left: the count is taken one company at a time.
      await s.db.contactRequest.createMany({ data: Array.from({ length: CONTACT_REQUESTS_PER_DAY - 1 }, () => row(s.dataCo.row.id, new Date(Date.now() - hour))) })
      const [cardA, cardB] = [await s.cardId('Aziz', s.dataCo), await s.cardId('Bobur', s.dataCo)]
      const both = await Promise.allSettled([cardA, cardB].map((card) => section.request(s.tenantId, s.dataCo.actor, s.institution.id, card)))
      expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
      expect((both.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'rate_limited', status: 429 })
      expect(await s.db.contactRequest.count({ where: { companyId: s.dataCo.row.id, createdAt: { gte: new Date(Date.now() - 24 * hour) } } })).toBe(CONTACT_REQUESTS_PER_DAY)
      expect(await s.db.contactRequest.count({ where: { companyId: s.dataCo.row.id, source: 'STUDENTS' } })).toBe(1)
    })
  })
})
