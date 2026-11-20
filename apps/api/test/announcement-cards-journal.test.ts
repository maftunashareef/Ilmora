import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registrySearchKey, STUDENT_CARDS_PER_DAY } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import { GraduatesService } from '../src/modules/graduates/graduates.service'
import type { NotificationsService } from '../src/modules/notifications/notifications.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'

/**
 * Security check 19.11, finding №1: a graduate card in an announcement must not be read without its row in the journal.
 *
 * In «Студенты» every card a company sees is written to the audit log (`student.card.view`) and counted in the daily
 * limit (CompanyStudentCardView, STUDENT_CARDS_PER_DAY) before the answer leaves. The same cards — name, «о себе»,
 * region, certificates, courses — come out of an announcement (`GET /announcements/:id`, and the answers of «Откликнуться»
 * and «Пригласить») with neither: a company can read them again and again, unseen and unlimited.
 *
 * The rule, for every path that hands out cards: each card has its `*.card.view` row (the student, the company) written
 * by that request, the cards are counted in the same daily limit, and over the limit no card leaves.
 *
 * KNOWN_GAP_N1 pins today's state precisely: the scenario must still work (cards really come out — a broken setup fails
 * the test, unlike `it.fails`) and the rule must still be broken. Close №1 → this test fails and says to set it to false;
 * from then on the rule is demanded.
 */
const KNOWN_GAP_N1 = true

const SERVICE = join(__dirname, '../src/modules/graduates/graduates.service.ts')
/** The GraduatesService methods whose answer carries graduate cards — each is checked against the journal below. */
const CARD_PATHS = ['companyGet', 'invite', 'respond']

/** Holds or is the known gap — and says what to do when the gap is closed. */
function rule(holds: boolean, what: string) {
  if (KNOWN_GAP_N1) expect(holds, `${what} — now holds: finding №1 is closed, set KNOWN_GAP_N1 = false in this file`).toBe(false)
  else expect(holds, what).toBe(true)
}

describe('Graduate cards in announcements: every path that hands them out is known', () => {
  it('only companyGet, respond and invite build the announcement with its cards — a new one fails here until it is checked below', () => {
    const lines = readFileSync(SERVICE, 'utf8').split('\n')
    /** The last argument of the call that opens at `from` (parentheses counted, so nested calls do not end it). */
    const lastArg = (text: string, from: number) => {
      let depth = 0
      let start = from
      for (let i = from; i < text.length; i++) {
        if (text[i] === '(') depth++
        else if (text[i] === ')' && --depth === 0) return text.slice(start, i).trim()
        else if (text[i] === ',' && depth === 1) start = i + 1
      }
      return null
    }
    const withCards = new Set<string>()
    let method = ''
    for (const line of lines) {
      const head = /^ {2}(?:(?:public|private|protected) )?(?:async )?(\w+)\s*\(/.exec(line)
      if (head && !['if', 'for', 'while', 'switch', 'return'].includes(head[1])) method = head[1]
      for (const call of line.matchAll(/this\.(?:companyAnnouncement|companyView)\(/g)) {
        const flag = lastArg(line, call.index + call[0].length - 1)
        // companyAnnouncement(…, true) / companyView(…, true): the announcement with its graduates. The one pass-through
        // is companyAnnouncement handing its own flag on; anything else that is not a literal is refused, to be looked at.
        if (flag === 'true') withCards.add(method)
        else if (flag !== 'false' && !(method === 'companyAnnouncement' && flag === 'withGraduates')) withCards.add(`${method} (flag: ${flag})`)
      }
    }
    expect([...withCards].sort()).toEqual(CARD_PATHS)
  })
})

describe.skipIf(!DB_AVAILABLE)('Graduate cards in announcements: no card without its row in the journal (check 19.11, №1)', () => {
  const ctx = new TestContext()
  const notifications = {
    notify: async () => 1,
    safely: async (_l: string, fn: () => Promise<unknown>) => { await fn() },
  } as unknown as NotificationsService
  class MemoryDocs extends PrivateDocsService {
    constructor() { super(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })) }
  }
  const contacts = new ContactsService(ctx.prisma, ctx.audit, notifications, new MemoryDocs())
  const service = new GraduatesService(ctx.prisma, ctx.audit, notifications, contacts, ctx.env)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const YEAR = new Date().getUTCFullYear()

  /** A published IT announcement of an approved institution, two consenting confirmed graduates, an approved IT company. */
  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const tenantId = t.tenantId
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn)
    await TenantContext.system(() => seedRegistryReference(db as never, tenantId))
    return inT(async () => {
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const direction = await db.direction.create({ data: { tenantId, name: 'Dasturlaş', searchKey: registrySearchKey('Dasturlaş'), industryId: it.id } })
      const inst = await db.institution.create({
        data: { tenantId, type: 'TECHNIKUM', name: 'IT texnikumi', searchKey: registrySearchKey('IT texnikumi'), regionId: tashkent.id, source: 'SELF', status: 'APPROVED', approvedAt: new Date() },
      })
      await db.institutionDirection.create({ data: { tenantId, institutionId: inst.id, directionId: direction.id, studentsCount: 100 } })
      let n = 0
      const rep = await db.user.create({ data: { tenantId, login: `u-${label}-${++n}`, displayName: 'Rep', roles: ['INSTITUTION_ADMIN'], institutionId: inst.id } })
      const instActor = { id: rep.id, roles: ['INSTITUTION_ADMIN'] } as RequestActor
      const co = await db.company.create({ data: { tenantId, stir: '401111111', name: 'Soft Co', searchKey: registrySearchKey('Soft Co'), status: 'APPROVED', approvedAt: new Date(), regionId: tashkent.id } })
      await db.companyIndustry.create({ data: { companyId: co.id, industryId: it.id } })
      const coUser = await db.user.create({ data: { tenantId, login: `u-${label}-${++n}`, displayName: 'Co rep', roles: ['COMPANY_ADMIN'], companyId: co.id } })
      const company = { id: co.id, actor: { id: coUser.id, roles: ['COMPANY_ADMIN'] } as RequestActor }
      const userByName = new Map<string, string>()
      for (const name of ['Aziz', 'Bobur']) {
        const phone = `+99890${String(++n).padStart(3, '0')}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`
        const u = await db.user.create({ data: { tenantId, phoneE164: phone, phoneVerifiedAt: new Date(), displayName: name, roles: ['STUDENT'] } })
        await db.studentProfile.create({
          data: { tenantId, userId: u.id, mode: 'STUDYING', institutionType: 'TECHNIKUM', institutionId: inst.id, course: 3, graduationYear: YEAR, directionId: direction.id, regionId: tashkent.id, about: 'Python', studyConfirmation: 'CONFIRMED' },
        })
        await db.studentConsent.create({ data: { tenantId, userId: u.id, kind: 'GRADUATE_CARD', textVersion: 'v1' } })
        userByName.set(name, u.id)
      }
      const draft = await service.create(tenantId, instActor, { year: YEAR, lines: [{ directionId: direction.id, count: 40 }] })
      const ann = await service.publish(tenantId, instActor, draft.id)

      /** Card views of this company in the journal, and the cards counted in its daily limit. */
      const journal = async () => ({
        views: (await db.auditEvent.findMany({ where: { action: { endsWith: 'card.view' }, entityType: 'User' }, select: { entityId: true, after: true } }))
          .filter((v) => (v.after as { companyId?: string } | null)?.companyId === co.id).map((v) => v.entityId),
        counted: (await db.companyStudentCardView.aggregate({ where: { companyId: co.id }, _sum: { cards: true } }))._sum.cards ?? 0,
      })

      /**
       * Runs one path and tells whether its cards came out with their rows: each card's student written once by this
       * request, and the request's cards counted. Throws (fails the test) if the path hands out no card at all.
       */
      const read = async (path: () => Promise<{ graduates?: { name: unknown }[] }>) => {
        const before = await journal()
        const dto = await path()
        const after = await journal()
        const shown = (dto.graduates ?? []).map((g) => userByName.get(g.name as string)!)
        expect(shown.length, 'the path hands out graduate cards').toBeGreaterThan(0)
        expect(shown.every(Boolean), 'every card is one of the graduates').toBe(true)
        const written = after.views.slice()
        for (const v of before.views) written.splice(written.indexOf(v), 1)
        return { written: [...written].sort().join() === [...shown].sort().join(), counted: after.counted - before.counted === shown.length }
      }
      return { tenantId, inT, db, ann, company, userByName, journal, read }
    })
  }

  it('GET /announcements/:id: every card has its row in the journal and is counted in the daily limit', async () => {
    const s = await setup('acj-get')
    await s.inT(async () => {
      const r = await s.read(() => service.companyGet(s.company.actor, s.ann.id))
      rule(r.written, 'GET /announcements/:id writes a card view for every card it returns')
      rule(r.counted, 'GET /announcements/:id counts its cards in the daily limit (CompanyStudentCardView)')
    })
  })

  it('«Откликнуться» (POST /announcements/:id/responses): the cards in its answer are written and counted too', async () => {
    const s = await setup('acj-respond')
    await s.inT(async () => {
      // The line id comes from the list — it carries no cards, so nothing is read past the journal to get it.
      const [visible] = await service.companyList(s.company.actor, {})
      expect(visible.graduates, 'the list hands out no cards').toBeUndefined()
      const r = await s.read(() => service.respond(s.tenantId, s.company.actor, s.ann.id, { lines: [{ lineId: visible.lines[0].id, wantedCount: 1 }], comment: null }))
      rule(r.written && r.counted, '«Откликнуться» writes and counts the cards of its answer')
    })
  })

  it('«Пригласить» (POST /graduates/:cardId/invite): the cards in its answer are written and counted too', async () => {
    const s = await setup('acj-invite')
    await s.inT(async () => {
      // A card id is only got by reading the announcement; that read is not this path's.
      const cardId = (await service.companyGet(s.company.actor, s.ann.id)).graduates!.find((g) => g.name === 'Aziz')!.cardId
      const r = await s.read(() => service.invite(s.tenantId, s.company.actor, cardId, s.ann.id))
      rule(r.written && r.counted, '«Пригласить» writes and counts the cards of its answer')
    })
  })

  it('over the daily limit no card leaves the announcement, and nothing is written', async () => {
    const s = await setup('acj-limit')
    await s.inT(async () => {
      // The company has seen its whole day of cards in «Студенты» an hour ago.
      await s.db.companyStudentCardView.create({ data: { companyId: s.company.id, cards: STUDENT_CARDS_PER_DAY, createdAt: new Date(Date.now() - 3_600_000) } })
      const before = await s.journal()
      const answer = await service.companyGet(s.company.actor, s.ann.id).then((dto) => dto, (e: unknown) => e as { code?: string; status?: number })
      const refused = 'status' in answer && answer.status === 429 && answer.code === 'rate_limited'
      const noCards = 'id' in answer && !(answer as { graduates?: unknown[] }).graduates?.length
      expect(refused || 'id' in answer, 'answered or refused with 429 — not any other error').toBe(true)
      expect(await s.journal(), 'a refused read leaves nothing in the journal').toEqual(before)
      rule(refused || noCards, 'over the daily limit GET /announcements/:id hands out no card')
    })
  })
})
