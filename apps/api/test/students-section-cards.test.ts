import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registrySearchKey, STUDENT_CARDS_PER_DAY, STUDENTS_PAGE_SIZE } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import { CompanyStudentsService } from '../src/modules/graduates/company-students.service'
import { CompanyStudentsController } from '../src/modules/graduates/graduates.controller'
import { NotificationsService } from '../src/modules/notifications/notifications.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'

const Y = new Date().getUTCFullYear()
const HOUR = 3_600_000

describe('«Студенты» у компании: request limits on the addresses', () => {
  // @Throttle keeps its numbers on the handler, under the throttler's name.
  const throttle = (handler: object) => ({ limit: Reflect.getMetadata('THROTTLER:LIMITdefault', handler), ttl: Reflect.getMetadata('THROTTLER:TTLdefault', handler) })

  it('60 a minute on both lists; «Запросить контакты» — 20 a minute (its 50 a day are counted in the database)', () => {
    const c = CompanyStudentsController.prototype
    expect(throttle(c.blocks)).toEqual({ limit: 60, ttl: 60_000 })
    expect(throttle(c.page)).toEqual({ limit: 60, ttl: 60_000 })
    expect(throttle(c.request)).toEqual({ limit: 20, ttl: 60_000 })
  })
})

describe.skipIf(!DB_AVAILABLE)('«Студенты» у компании: the institution’s state, the audit of every card, the daily limit of cards', () => {
  const ctx = new TestContext()
  const notifications = new NotificationsService(ctx.prisma, { publish: async () => undefined } as never)
  class MemoryDocs extends PrivateDocsService {
    constructor() { super(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })) }
  }
  const contacts = new ContactsService(ctx.prisma, ctx.audit, notifications, new MemoryDocs())
  const section = new CompanyStudentsService(ctx.prisma, ctx.audit, contacts, ctx.env)
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
      let n = 0
      const institution = (name: string) => db.institution.create({ data: { tenantId, type: 'COLLEGE', name, searchKey: registrySearchKey(name), regionId: tashkent.id, source: 'IMPORT', status: 'APPROVED', approvedAt: new Date() } })
      const representative = async (companyId: string) => {
        const u = await db.user.create({ data: { tenantId, login: `u-${label}-${++n}`, displayName: `Rep ${n}`, roles: ['COMPANY_ADMIN'], companyId } })
        return { id: u.id, roles: ['COMPANY_ADMIN'] } as RequestActor
      }
      const company = async (name: string, stir: string) => {
        const row = await db.company.create({ data: { tenantId, stir, name, searchKey: registrySearchKey(name), status: 'APPROVED', approvedAt: new Date(), regionId: tashkent.id } })
        await db.companyIndustry.create({ data: { companyId: row.id, industryId: it.id } })
        return { row, actor: await representative(row.id) }
      }
      /** A confirmed, consenting adult student of the institution, straight in the database. */
      const student = async (name: string, institutionId: string) => {
        const phone = `+99890${String(++n).padStart(3, '0')}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`
        const u = await db.user.create({ data: { tenantId, displayName: name, phoneE164: phone, phoneVerifiedAt: new Date(), email: `s${n}@mail.uz`, roles: ['STUDENT'] } })
        await db.studentProfile.create({
          data: {
            tenantId, userId: u.id, mode: 'STUDYING', institutionType: 'COLLEGE', institutionId, course: 2, graduationYear: Y + 2, directionId: direction.id,
            birthDate: new Date(`${Y - 20}-05-01T00:00:00Z`), regionId: tashkent.id, about: 'Python', contactPhone: '+998935554433', studyConfirmation: 'CONFIRMED',
          },
        })
        await db.studentConsent.create({ data: { tenantId, userId: u.id, kind: 'INDUSTRY_CARD', textVersion: 'v1' } })
        return { id: u.id, phone, email: `s${n}@mail.uz` }
      }
      const college = await institution('Toşkent kolleji')
      return {
        tenantId, db, college, institution, student, representative,
        inT: <T>(fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn),
        softCo: await company('Soft Co', '401111111'),
        dataCo: await company('Data Co', '403333333'),
        /** Pages already shown to a company, straight in the journal the limit counts. */
        shown: (companyId: string, cards: number, hoursAgo = 1) => db.companyStudentCardView.create({ data: { companyId, cards, createdAt: new Date(Date.now() - hoursAgo * HOUR) } }),
        counted: async (companyId: string) => (await db.companyStudentCardView.aggregate({ where: { companyId, createdAt: { gt: new Date(Date.now() - 24 * HOUR) } }, _sum: { cards: true } }))._sum.cards ?? 0,
        views: () => db.auditEvent.findMany({ where: { action: 'student.card.view' }, select: { entityType: true, entityId: true, after: true } }),
      }
    })
  }

  it('students of a blocked, unapproved or merged institution are hidden and cannot be asked; unblocked — shown again', async () => {
    const s = await setup('sc-inst')
    await s.inT(async () => {
      const blocked = await s.institution('Bloklangan kollej')
      const unapproved = await s.institution('Tasdiqlanmagan kollej')
      const merged = await s.institution('Qo‘şilgan kollej')
      await s.student('Aziz', s.college.id)
      const hidden = [blocked, unapproved, merged]
      for (const [i, inst] of hidden.entries()) await s.student(`Hidden ${i}`, inst.id)
      const blockIds = async () => (await section.blocks(s.softCo.actor, {})).map((b) => b.institution.id).sort()
      const names = async (institutionId: string) => (await section.page(s.softCo.actor, institutionId, {}, 1)).items.map((c) => c.name)

      // All four are in the registry: every student shows; the card ids are taken while they do.
      expect(await blockIds()).toEqual([s.college.id, ...hidden.map((i) => i.id)].sort())
      const cardIds = new Map<string, string>()
      for (const inst of hidden) cardIds.set(inst.id, (await section.page(s.softCo.actor, inst.id, {}, 1)).items[0].cardId)

      await s.db.institution.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } })
      await s.db.institution.update({ where: { id: unapproved.id }, data: { approvedAt: null } })
      await s.db.institution.update({ where: { id: merged.id }, data: { mergedIntoId: s.college.id } })

      expect(await blockIds()).toEqual([s.college.id])
      for (const inst of hidden) {
        expect(await section.page(s.softCo.actor, inst.id, {}, 1)).toMatchObject({ items: [], total: 0 })
        await expect(section.request(s.tenantId, s.softCo.actor, inst.id, cardIds.get(inst.id)!)).rejects.toMatchObject({ code: 'not_found', status: 404 })
      }
      expect(await s.db.contactRequest.count({ where: { companyId: s.softCo.row.id } })).toBe(0)
      expect(await names(s.college.id)).toEqual(['Aziz'])

      // The confirmations were kept: unblocked, the institution's students show again by themselves.
      await s.db.institution.update({ where: { id: blocked.id }, data: { blockedAt: null } })
      expect(await blockIds()).toEqual([s.college.id, blocked.id].sort())
      expect(await names(blocked.id)).toEqual(['Hidden 0'])
      expect(await section.request(s.tenantId, s.softCo.actor, blocked.id, cardIds.get(blocked.id)!)).toMatchObject({ name: 'Hidden 0', contactRequest: 'PENDING' })
    })
  })

  it('a deleted account is not shown', async () => {
    const s = await setup('sc-deleted')
    await s.inT(async () => {
      await s.student('Aziz', s.college.id)
      const gone = await s.student('Bobur', s.college.id)
      expect((await section.page(s.softCo.actor, s.college.id, {}, 1)).items.map((c) => c.name)).toEqual(['Aziz', 'Bobur'])
      await s.db.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } })
      expect((await section.blocks(s.softCo.actor, {})).map((b) => b.students)).toEqual([1])
      expect(await section.page(s.softCo.actor, s.college.id, {}, 1)).toMatchObject({ total: 1, items: [{ name: 'Aziz' }] })
    })
  })

  it('every card shown is in the audit log with the student and the company; an empty page leaves nothing; no account data in the answers', async () => {
    const s = await setup('sc-audit')
    await s.inT(async () => {
      const students = [await s.student('Aziz', s.college.id), await s.student('Bobur', s.college.id), await s.student('Dilnoza', s.college.id)]
      const empty = await s.institution('Bo‘ş kollej')

      // The blocks show no cards: nothing to write, nothing counted.
      const blocks = await section.blocks(s.softCo.actor, {})
      expect(await s.views()).toEqual([])
      // Empty pages: an institution without students, and a page past the last one.
      expect((await section.page(s.softCo.actor, empty.id, {}, 1)).items).toEqual([])
      expect((await section.page(s.softCo.actor, s.college.id, {}, 2)).items).toEqual([])
      expect(await s.views()).toEqual([])
      expect(await s.counted(s.softCo.row.id)).toBe(0)

      const page = await section.page(s.softCo.actor, s.college.id, {}, 1)
      expect(page.items.map((c) => c.name)).toEqual(['Aziz', 'Bobur', 'Dilnoza'])
      const views = await s.views()
      expect(views.map((v) => v.entityId).sort()).toEqual(students.map((u) => u.id).sort())
      for (const v of views) expect(v).toMatchObject({ entityType: 'User', after: { companyId: s.softCo.row.id, institutionId: s.college.id, page: 1 } })
      expect(await s.counted(s.softCo.row.id)).toBe(3)
      expect(await s.db.auditEvent.count({ where: { action: 'students.page.view' } })).toBe(0)

      // Shown again — written and counted again; another company's views are its own.
      await section.page(s.softCo.actor, s.college.id, {}, 1)
      await section.page(s.dataCo.actor, s.college.id, {}, 1)
      const all = await s.views()
      expect(all).toHaveLength(9)
      expect(all.filter((v) => (v.after as { companyId: string }).companyId === s.dataCo.row.id).map((v) => v.entityId).sort()).toEqual(students.map((u) => u.id).sort())
      expect(await s.counted(s.softCo.row.id)).toBe(6)
      expect(await s.counted(s.dataCo.row.id)).toBe(3)

      // Neither answer carries an account id, a phone, an e-mail or a birth date.
      const text = JSON.stringify([blocks, page])
      for (const secret of ['+998935554433', '@mail.uz', `${Y - 20}-05-01`, ...students.flatMap((u) => [u.id, u.phone, u.email])]) expect(text).not.toContain(secret)
      expect(Object.keys(page.items[0]).sort()).toEqual(['about', 'cardId', 'certificates', 'contactRequest', 'course', 'direction', 'graduationYear', 'ilmoraCourses', 'institution', 'name', 'region', 'studyConfirmed'])
      expect(Object.keys(blocks[0]).sort()).toEqual(['institution', 'students'])
    })
  })

  it('the daily limit: the 1000th card passes, the next page is refused whole with the real time to wait', async () => {
    const s = await setup('sc-limit')
    await s.inT(async () => {
      for (const name of ['Aziz', 'Bobur', 'Dilnoza']) await s.student(name, s.college.id)
      const page = () => section.page(s.softCo.actor, s.college.id, {}, 1)
      // Pages older than 24 hours no longer count.
      await s.shown(s.softCo.row.id, STUDENT_CARDS_PER_DAY, 25)
      // 997 cards an hour ago: the page of three is cards 998–1000.
      await s.shown(s.softCo.row.id, STUDENT_CARDS_PER_DAY - 3, 1)
      expect((await page()).items).toHaveLength(3)
      expect(await s.counted(s.softCo.row.id)).toBe(STUDENT_CARDS_PER_DAY)
      expect(await s.views()).toHaveLength(3)

      // Over the limit: 429, and the wait is until the oldest counted page (an hour old) leaves the 24 hours — not a round hour.
      const refused = await page().then(() => null, (e: unknown) => e as { code: string; status: number; details?: { retryAfterSeconds?: number } })
      expect(refused).toMatchObject({ code: 'rate_limited', status: 429 })
      const wait = refused!.details!.retryAfterSeconds!
      expect(wait).toBeGreaterThan(23 * 3600 - 120)
      expect(wait).toBeLessThanOrEqual(23 * 3600)
      // Nothing was written for the refused page; the blocks (no cards) still open.
      expect(await s.views()).toHaveLength(3)
      expect(await s.counted(s.softCo.row.id)).toBe(STUDENT_CARDS_PER_DAY)
      expect((await section.blocks(s.softCo.actor, {})).map((b) => b.students)).toEqual([3])
      // An empty page costs nothing, so it is still answered.
      expect((await section.page(s.softCo.actor, s.college.id, {}, 2)).items).toEqual([])

      // A page that fits only in part is not given in part: 998 shown, three more would make 1001.
      await s.shown(s.dataCo.row.id, STUDENT_CARDS_PER_DAY - 2, 2)
      await expect(section.page(s.dataCo.actor, s.college.id, {}, 1)).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
      expect(await s.counted(s.dataCo.row.id)).toBe(STUDENT_CARDS_PER_DAY - 2)
      expect((await s.views()).filter((v) => (v.after as { companyId: string }).companyId === s.dataCo.row.id)).toEqual([])
    })
  })

  it('the limit is the company’s: a new representative does not reset it, another company has its own', async () => {
    const s = await setup('sc-company')
    await s.inT(async () => {
      for (const name of ['Aziz', 'Bobur']) await s.student(name, s.college.id)
      await s.shown(s.softCo.row.id, STUDENT_CARDS_PER_DAY - 2)
      expect((await section.page(s.softCo.actor, s.college.id, {}, 1)).items).toHaveLength(2)
      await expect(section.page(s.softCo.actor, s.college.id, {}, 1)).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
      // The company's account is replaced (one representative per company): the count stays.
      await s.db.user.update({ where: { id: s.softCo.actor.id }, data: { companyId: null, isActive: false } })
      const successor = await s.representative(s.softCo.row.id)
      await expect(section.page(successor, s.college.id, {}, 1)).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
      // Another company is not touched.
      expect((await section.page(s.dataCo.actor, s.college.id, {}, 1)).items).toHaveLength(2)
    })
  })

  it('pages asked for at once do not pass over the limit', async () => {
    const s = await setup('sc-race')
    await s.inT(async () => {
      for (const name of ['Aziz', 'Bobur', 'Dilnoza']) await s.student(name, s.college.id)
      // Room for exactly two pages of three.
      await s.shown(s.softCo.row.id, STUDENT_CARDS_PER_DAY - 6)
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => section.page(s.softCo.actor, s.college.id, {}, 1)))
      const passed = results.filter((r) => r.status === 'fulfilled')
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(passed).toHaveLength(2)
      expect(refused).toHaveLength(6)
      for (const r of refused) expect(r.reason).toMatchObject({ code: 'rate_limited', status: 429 })
      expect(await s.counted(s.softCo.row.id)).toBe(STUDENT_CARDS_PER_DAY)
      expect(await s.views()).toHaveLength(6)
    })
  })

  it('a full page is STUDENTS_PAGE_SIZE cards, each with its own audit row', async () => {
    const s = await setup('sc-page')
    await s.inT(async () => {
      for (let i = 0; i < STUDENTS_PAGE_SIZE + 1; i++) await s.student(`Student ${String(i).padStart(2, '0')}`, s.college.id)
      expect((await section.page(s.softCo.actor, s.college.id, {}, 1)).items).toHaveLength(STUDENTS_PAGE_SIZE)
      expect(await s.views()).toHaveLength(STUDENTS_PAGE_SIZE)
      expect((await section.page(s.softCo.actor, s.college.id, {}, 2)).items).toHaveLength(1)
      expect(new Set((await s.views()).map((v) => v.entityId)).size).toBe(STUDENTS_PAGE_SIZE + 1)
      expect(await s.counted(s.softCo.row.id)).toBe(STUDENTS_PAGE_SIZE + 1)
    })
  })
})
