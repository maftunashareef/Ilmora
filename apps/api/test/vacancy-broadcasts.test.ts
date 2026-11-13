import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registrySearchKey, VACANCY_BROADCASTS_PER_DAY } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import { NotificationsService } from '../src/modules/notifications/notifications.service'
import { RegistryService } from '../src/modules/registry/registry.service'
import { StudentsService } from '../src/modules/students/students.service'
import { deliverBroadcast, InstitutionVacanciesService } from '../src/modules/vacancies/institution-vacancies.service'
import { VacanciesService } from '../src/modules/vacancies/vacancies.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'

const Y = new Date().getUTCFullYear()
const HOUR_MS = 3_600_000

/**
 * «Разослать студентам» — reliability of the delivery and of the limits: a batch's recipients and notifications commit
 * together; the vacancy, the institution and the students are checked again when the queue delivers; the audit row is
 * in the sending transaction; the daily limit holds under simultaneous requests and says when to come back.
 */
describe.skipIf(!DB_AVAILABLE)('«Разослать студентам»: delivery, re-checks and limits', () => {
  const ctx = new TestContext()
  const notifications = new NotificationsService(ctx.prisma, { publish: async () => undefined } as never)
  class MemoryDocs extends PrivateDocsService {
    constructor() { super(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })) }
  }
  const docs = new MemoryDocs()
  const contacts = new ContactsService(ctx.prisma, ctx.audit, notifications, docs)
  const studentsSvc = new StudentsService(ctx.prisma, ctx.audit, notifications, new RegistryService(ctx.prisma, ctx.audit))
  const vacancies = new VacanciesService(ctx.prisma, ctx.audit, notifications, contacts, studentsSvc, docs)
  const instVacancies = new InstitutionVacanciesService(ctx.prisma, ctx.audit, ctx.outbox)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /** A tenant with two IT directions and a furniture one, two institutions, two companies; students straight in the database. */
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
      const dir = (name: string, industryId: string) => db.direction.create({ data: { tenantId, name, searchKey: registrySearchKey(name), industryId } })
      const dasturlash = await dir('Dasturlaş', it.id)
      const kiber = await dir('Kiberxavfsizlik', it.id)
      const mebel = await dir('Mebel', furniture.id)
      let n = 0
      const user = (roles: string[], link: object) => db.user.create({ data: { tenantId, login: `u-${label}-${++n}`, displayName: `Rep ${n}`, roles: roles as never, ...link } })
      const institution = async (name: string, directions: string[]) => {
        const row = await db.institution.create({ data: { tenantId, type: 'COLLEGE', name, searchKey: registrySearchKey(name), regionId: tashkent.id, source: 'IMPORT', status: 'APPROVED', approvedAt: new Date() } })
        for (const directionId of directions) await db.institutionDirection.create({ data: { tenantId, institutionId: row.id, directionId, studentsCount: 50 } })
        const u = await user(['INSTITUTION_ADMIN'], { institutionId: row.id })
        return { row, actor: { id: u.id, roles: ['INSTITUTION_ADMIN'] } as RequestActor }
      }
      const company = async (name: string, stir: string, industryIds: string[]) => {
        const row = await db.company.create({ data: { tenantId, stir, name, searchKey: registrySearchKey(name), status: 'APPROVED', approvedAt: new Date(), regionId: tashkent.id } })
        for (const industryId of industryIds) await db.companyIndustry.create({ data: { companyId: row.id, industryId } })
        const u = await user(['COMPANY_ADMIN'], { companyId: row.id })
        return { row, actor: { id: u.id, roles: ['COMPANY_ADMIN'] } as RequestActor }
      }
      const college = await institution('Toşkent kolleji', [dasturlash.id, kiber.id, mebel.id])
      const itOnly = await institution('IT texnikumi', [dasturlash.id])
      /** A confirmed second-year student of programming, unless said otherwise. */
      const student = async (name: string, inst: { row: { id: string } } = college) => {
        const u = await db.user.create({ data: { tenantId, displayName: name, phoneE164: `+99890${String(++n).padStart(3, '0')}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`, phoneVerifiedAt: new Date(), roles: ['STUDENT'] } })
        await db.studentProfile.create({
          data: {
            tenantId, userId: u.id, mode: 'STUDYING', institutionType: 'COLLEGE', institutionId: inst.row.id, course: 2, graduationYear: Y + 2,
            directionId: dasturlash.id, birthDate: new Date(`${Y - 20}-05-01T00:00:00Z`), regionId: tashkent.id, studyConfirmation: 'CONFIRMED',
          },
        })
        return u.id
      }
      const softCo = await company('Soft Co', '401111111', [it.id])
      const mebelCo = await company('Mebel Co', '402222222', [furniture.id])
      const vacancy = (co: typeof softCo, over: object = {}) => vacancies.create(tenantId, co.actor, { kind: 'PRACTICE', title: 'Python amaliyot', directionIds: [dasturlash.id], region: 'tashkent-city', format: 'ONSITE', paid: false, seats: 2, ...over } as never)
      return {
        tenantId, dasturlash, kiber, mebel, college, itOnly, softCo, mebelCo, student, vacancy,
        input: { directionIds: [dasturlash.id], courses: [2] },
        inT: <T>(fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn),
      }
    })
  }
  const db = () => ctx.prisma.client
  const told = (vacancyId: string) => db().notification.findMany({ where: { type: 'vacancy.broadcast', params: { path: ['vacancyId'], equals: vacancyId } }, select: { userId: true } })
  const journal = async (actor: RequestActor, id: string) => (await instVacancies.broadcasts(actor)).find((b) => b.id === id)!

  it('a failure after a batch’s recipients were written leaves nobody without a notification: the retry tells everyone once', async () => {
    const s = await setup('vb-atomic')
    await s.inT(async () => {
      const v = await s.vacancy(s.softCo)
      const students = [await s.student('A'), await s.student('B'), await s.student('C')]
      const b = await instVacancies.send(s.tenantId, s.college.actor, v.id, s.input)

      // The first attempt writes the batch's notifications and then fails, as a crash right after them would.
      const real = notifications.notify.bind(notifications)
      const spy = vi.spyOn(notifications, 'notify').mockImplementationOnce(async (input, tx) => { await real(input, tx); throw new Error('queue worker died') })
      try {
        await expect(deliverBroadcast(ctx.prisma, notifications, b.id)).rejects.toThrow('queue worker died')
        // Neither half of the batch stayed: the students are still in the audience, the broadcast is still open.
        expect(await db().vacancyBroadcastRecipient.count({ where: { broadcastId: b.id } })).toBe(0)
        expect(await told(v.id)).toEqual([])
        expect(await journal(s.college.actor, b.id)).toMatchObject({ finishedAt: null, recipientsCount: 3, deliveredCount: 0 })

        // The queue runs the event again.
        expect(await deliverBroadcast(ctx.prisma, notifications, b.id)).toEqual({ sent: 3 })
      } finally {
        spy.mockRestore()
      }
      expect((await told(v.id)).map((n) => n.userId).sort()).toEqual([...students].sort())
      expect(await db().vacancyBroadcastRecipient.count({ where: { broadcastId: b.id } })).toBe(3)
      expect(await journal(s.college.actor, b.id)).toMatchObject({ finishedAt: expect.any(String), recipientsCount: 3, deliveredCount: 3 })
      // One more run of the same event, and a notification written again by hand with the same key: no doubles.
      expect(await deliverBroadcast(ctx.prisma, notifications, b.id)).toEqual({ sent: 0 })
      expect(await notifications.notify({ tenantId: s.tenantId, userIds: students, type: 'vacancy.broadcast', params: { vacancyId: v.id }, dedupeKey: `vacancy-broadcast:${v.id}` })).toBe(0)
      expect(await told(v.id)).toHaveLength(3)
    })
  })

  it('a notification that fails on the first attempt without writing anything: the retry still reaches everyone', async () => {
    const s = await setup('vb-retry')
    await s.inT(async () => {
      const v = await s.vacancy(s.softCo)
      const students = [await s.student('A'), await s.student('B')]
      const b = await instVacancies.send(s.tenantId, s.college.actor, v.id, s.input)
      const spy = vi.spyOn(notifications, 'notify').mockRejectedValueOnce(new Error('no connection'))
      try {
        await expect(deliverBroadcast(ctx.prisma, notifications, b.id)).rejects.toThrow('no connection')
        expect(await db().vacancyBroadcastRecipient.count({ where: { broadcastId: b.id } })).toBe(0)
        expect(await deliverBroadcast(ctx.prisma, notifications, b.id)).toEqual({ sent: 2 })
      } finally {
        spy.mockRestore()
      }
      expect((await told(v.id)).map((n) => n.userId).sort()).toEqual([...students].sort())
    })
  })

  it('the deadline passed, the company blocked or the institution blocked before the queue ran: nobody gets it, the broadcast is closed', async () => {
    const s = await setup('vb-recheck')
    await s.inT(async () => {
      await s.student('A')
      const undelivered = async (b: { id: string }, vacancyId: string) => {
        expect(await deliverBroadcast(ctx.prisma, notifications, b.id)).toEqual({ sent: 0 })
        expect(await db().vacancyBroadcastRecipient.count({ where: { broadcastId: b.id } })).toBe(0)
        expect(await told(vacancyId)).toEqual([])
        const row = await db().vacancyBroadcast.findUniqueOrThrow({ where: { id: b.id }, select: { finishedAt: true, recipientsCount: true } })
        expect(row.finishedAt).toBeInstanceOf(Date)
        expect(row.recipientsCount).toBe(1)
      }

      // The last day to apply has passed.
      const expired = await s.vacancy(s.softCo, { title: 'Muddati ötgan' })
      const b1 = await instVacancies.send(s.tenantId, s.college.actor, expired.id, s.input)
      await db().vacancy.update({ where: { id: expired.id }, data: { deadline: new Date(Date.UTC(Y - 1, 0, 1)) } })
      await undelivered(b1, expired.id)
      // The journal shows both numbers: one at sending, none delivered.
      expect(await journal(s.college.actor, b1.id)).toMatchObject({ recipientsCount: 1, deliveredCount: 0, finishedAt: expect.any(String) })

      // The company was blocked.
      const ofBlocked = await s.vacancy(s.mebelCo, { title: 'Mebel amaliyot', directionIds: [s.mebel.id] })
      const mebelStudent = await s.student('M')
      await db().studentProfile.update({ where: { userId: mebelStudent }, data: { directionId: s.mebel.id } })
      const b2 = await instVacancies.send(s.tenantId, s.college.actor, ofBlocked.id, { directionIds: [s.mebel.id], courses: [2] })
      await db().company.update({ where: { id: s.mebelCo.row.id }, data: { blockedAt: new Date() } })
      await undelivered(b2, ofBlocked.id)

      // The institution itself was blocked.
      const open = await s.vacancy(s.softCo, { title: 'Oçiq' })
      const b3 = await instVacancies.send(s.tenantId, s.college.actor, open.id, s.input)
      await db().institution.update({ where: { id: s.college.row.id }, data: { blockedAt: new Date() } })
      await undelivered(b3, open.id)
    })
  })

  it('an institution that lost its approval or was merged into another before the queue ran delivers nothing', async () => {
    const s = await setup('vb-inst')
    await s.inT(async () => {
      await s.student('A')
      await s.student('B', s.itOnly)
      const v = await s.vacancy(s.softCo)
      const b1 = await instVacancies.send(s.tenantId, s.college.actor, v.id, s.input)
      await db().institution.update({ where: { id: s.college.row.id }, data: { mergedIntoId: s.itOnly.row.id } })
      expect(await deliverBroadcast(ctx.prisma, notifications, b1.id)).toEqual({ sent: 0 })
      const b2 = await instVacancies.send(s.tenantId, s.itOnly.actor, v.id, s.input)
      await db().institution.update({ where: { id: s.itOnly.row.id }, data: { approvedAt: null } })
      expect(await deliverBroadcast(ctx.prisma, notifications, b2.id)).toEqual({ sent: 0 })
      expect(await told(v.id)).toEqual([])
      expect(await db().vacancyBroadcast.count({ where: { id: { in: [b1.id, b2.id] }, finishedAt: { not: null } } })).toBe(2)
    })
  })

  it('a student rejected, turned applicant, deleted, disabled or moved to another institution after «Разослать» gets nothing', async () => {
    const s = await setup('vb-students')
    await s.inT(async () => {
      const v = await s.vacancy(s.softCo)
      const stays = await s.student('Stays')
      const rejected = await s.student('Rejected')
      const applying = await s.student('Applying')
      const deleted = await s.student('Deleted')
      const disabled = await s.student('Disabled')
      const moved = await s.student('Moved')
      const b = await instVacancies.send(s.tenantId, s.college.actor, v.id, s.input)
      expect(b.recipientsCount).toBe(6)

      await db().studentProfile.update({ where: { userId: rejected }, data: { studyConfirmation: 'REJECTED' } })
      await db().studentProfile.update({ where: { userId: applying }, data: { mode: 'APPLYING' } })
      await db().user.update({ where: { id: deleted }, data: { deletedAt: new Date() } })
      await db().user.update({ where: { id: disabled }, data: { isActive: false } })
      await db().studentProfile.update({ where: { userId: moved }, data: { institutionId: s.itOnly.row.id } })

      expect(await deliverBroadcast(ctx.prisma, notifications, b.id)).toEqual({ sent: 1 })
      expect((await told(v.id)).map((n) => n.userId)).toEqual([stays])
      expect((await db().vacancyBroadcastRecipient.findMany({ where: { broadcastId: b.id }, select: { userId: true } })).map((r) => r.userId)).toEqual([stays])
      // The journal: six when sent, one delivered.
      expect(await journal(s.college.actor, b.id)).toMatchObject({ recipientsCount: 6, deliveredCount: 1, finishedAt: expect.any(String) })
    })
  })

  it('sending — not only the preview — answers 404 for a closed vacancy, another industry’s and a blocked company’s; others’ directions are refused', async () => {
    const s = await setup('vb-send-access')
    await s.inT(async () => {
      await s.student('A')
      await s.student('B', s.itOnly)
      const open = await s.vacancy(s.softCo)
      // Directions: another industry's, one the institution does not teach, one that does not exist — refused, nothing written.
      await expect(instVacancies.send(s.tenantId, s.college.actor, open.id, { directionIds: [s.mebel.id], courses: [2] })).rejects.toMatchObject({ code: 'invalid_direction' })
      await expect(instVacancies.send(s.tenantId, s.college.actor, open.id, { directionIds: [s.dasturlash.id, s.mebel.id], courses: [2] })).rejects.toMatchObject({ code: 'invalid_direction' })
      await expect(instVacancies.send(s.tenantId, s.itOnly.actor, open.id, { directionIds: [s.kiber.id], courses: [2] })).rejects.toMatchObject({ code: 'invalid_direction' })
      await expect(instVacancies.send(s.tenantId, s.itOnly.actor, open.id, { directionIds: ['no-such-direction'], courses: [2] })).rejects.toMatchObject({ code: 'invalid_direction' })

      const closed = await s.vacancy(s.softCo, { title: 'Yopiq' })
      await vacancies.close(s.softCo.actor, closed.id)
      await expect(instVacancies.send(s.tenantId, s.college.actor, closed.id, s.input)).rejects.toMatchObject({ code: 'not_found', status: 404 })
      // A furniture vacancy for an institution that teaches IT only.
      const furniture = await s.vacancy(s.mebelCo, { title: 'Mebel amaliyot', directionIds: [s.mebel.id] })
      await expect(instVacancies.send(s.tenantId, s.itOnly.actor, furniture.id, s.input)).rejects.toMatchObject({ code: 'not_found', status: 404 })
      await db().company.update({ where: { id: s.softCo.row.id }, data: { blockedAt: new Date() } })
      await expect(instVacancies.send(s.tenantId, s.college.actor, open.id, s.input)).rejects.toMatchObject({ code: 'not_found', status: 404 })

      expect(await db().vacancyBroadcast.count({})).toBe(0)
      expect(await db().auditEvent.count({ where: { action: 'vacancy.broadcast' } })).toBe(0)
      expect(await TenantContext.system(() => db().outboxEvent.count({ where: { tenantId: s.tenantId, type: 'vacancy.broadcast' } }))).toBe(0)
    })
  })

  it('two broadcasts sent at once with 19 in the last 24 hours: exactly one passes; the refusal says when the oldest leaves the window', async () => {
    const s = await setup('vb-limit')
    await s.inT(async () => {
      const v = await s.vacancy(s.softCo)
      await s.student('A')
      // 19 broadcasts made 23½ hours ago: the next place frees in half an hour, not in the old fixed hour.
      const madeAt = new Date(Date.now() - 23.5 * HOUR_MS)
      await db().vacancyBroadcast.createMany({ data: Array.from({ length: VACANCY_BROADCASTS_PER_DAY - 1 }, () => ({ tenantId: s.tenantId, vacancyId: v.id, institutionId: s.college.row.id, courses: [1], createdById: 'x', recipientsCount: 0, createdAt: madeAt })) })

      const results = await Promise.allSettled([
        instVacancies.send(s.tenantId, s.college.actor, v.id, s.input),
        instVacancies.send(s.tenantId, s.college.actor, v.id, s.input),
      ])
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
      const refused = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason as { code: string; status: number; details?: { retryAfterSeconds?: number } }
      expect(refused).toMatchObject({ code: 'rate_limited', status: 429 })
      expect(refused.details?.retryAfterSeconds).toBeGreaterThan(29 * 60)
      expect(refused.details?.retryAfterSeconds).toBeLessThanOrEqual(30 * 60)
      expect(await db().vacancyBroadcast.count({ where: { institutionId: s.college.row.id } })).toBe(VACANCY_BROADCASTS_PER_DAY)
      expect(await TenantContext.system(() => db().outboxEvent.count({ where: { tenantId: s.tenantId, type: 'vacancy.broadcast' } }))).toBe(1)
      expect(await db().auditEvent.count({ where: { action: 'vacancy.broadcast' } })).toBe(1)
      expect((await instVacancies.preview(s.college.actor, v.id, s.input)).leftToday).toBe(0)

      // Another institution has its own count.
      await s.student('B', s.itOnly)
      await expect(instVacancies.send(s.tenantId, s.itOnly.actor, v.id, s.input)).resolves.toMatchObject({ recipientsCount: 1 })
      // Once the old ones are out of the 24 hours, the limit lets the next one through.
      await db().vacancyBroadcast.updateMany({ where: { institutionId: s.college.row.id, createdById: 'x' }, data: { createdAt: new Date(Date.now() - 25 * HOUR_MS) } })
      await expect(instVacancies.send(s.tenantId, s.college.actor, v.id, s.input)).resolves.toMatchObject({ recipientsCount: 1 })
    })
  })

  it('the audit row `vacancy.broadcast` holds the number of recipients and no student; it is written with the broadcast or not at all', async () => {
    const s = await setup('vb-audit')
    await s.inT(async () => {
      const v = await s.vacancy(s.softCo)
      const students = [await s.student('A'), await s.student('B')]
      const b = await instVacancies.send(s.tenantId, s.college.actor, v.id, s.input)
      const rows = await db().auditEvent.findMany({ where: { action: 'vacancy.broadcast' } })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ entityType: 'VacancyBroadcast', entityId: b.id, after: { vacancyId: v.id, institutionId: s.college.row.id, directionIds: [s.dasturlash.id], courses: [2], recipients: 2 } })
      const text = JSON.stringify(rows[0])
      for (const id of students) expect(text).not.toContain(id)
      // Delivery adds nothing to it.
      await deliverBroadcast(ctx.prisma, notifications, b.id)
      expect(JSON.stringify(await db().auditEvent.findMany({ where: { action: 'vacancy.broadcast' } }))).toBe(JSON.stringify(rows))

      // The audit insert fails: no broadcast, no event for the queue — the transaction is one.
      await s.student('C')
      const failing = new InstitutionVacanciesService(ctx.prisma, { record: async () => { throw new Error('audit is down') } } as never, ctx.outbox)
      await expect(failing.send(s.tenantId, s.college.actor, v.id, s.input)).rejects.toThrow('audit is down')
      expect(await db().vacancyBroadcast.count({ where: { vacancyId: v.id } })).toBe(1)
      expect(await TenantContext.system(() => db().outboxEvent.count({ where: { tenantId: s.tenantId, type: 'vacancy.broadcast' } }))).toBe(1)
      // The queue's event fails to be written: no broadcast and no audit row either.
      const noQueue = new InstitutionVacanciesService(ctx.prisma, ctx.audit, { enqueue: async () => { throw new Error('outbox is down') } } as never)
      await expect(noQueue.send(s.tenantId, s.college.actor, v.id, s.input)).rejects.toThrow('outbox is down')
      expect(await db().vacancyBroadcast.count({ where: { vacancyId: v.id } })).toBe(1)
      expect(await db().auditEvent.count({ where: { action: 'vacancy.broadcast' } })).toBe(1)
    })
  })

  it('the company learns nothing of broadcasts: neither its list nor its vacancy says who sent it or to how many', async () => {
    const s = await setup('vb-company')
    await s.inT(async () => {
      const v = await s.vacancy(s.softCo)
      const students = [await s.student('A'), await s.student('B')]
      const before = { list: await vacancies.companyList(s.softCo.actor), one: await vacancies.companyGet(s.softCo.actor, v.id) }
      const b = await instVacancies.send(s.tenantId, s.college.actor, v.id, s.input)
      expect(await deliverBroadcast(ctx.prisma, notifications, b.id)).toEqual({ sent: 2 })
      const after = { list: await vacancies.companyList(s.softCo.actor), one: await vacancies.companyGet(s.softCo.actor, v.id) }
      // The same answers as before the broadcast, and nothing in them that names it.
      expect(after).toEqual(before)
      const text = JSON.stringify(after)
      expect(text).not.toMatch(/broadcast|sentTo|recipient|delivered/i)
      for (const secret of [b.id, 'Toşkent kolleji', s.college.row.id, s.college.actor.id, ...students]) expect(text).not.toContain(secret)
      expect(after.one).not.toHaveProperty('sentTo')
    })
  })
})
