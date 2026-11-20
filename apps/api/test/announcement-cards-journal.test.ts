import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registrySearchKey, STUDENT_CARDS_PER_DAY } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import { CompanyStudentsService } from '../src/modules/graduates/company-students.service'
import { GraduatesService } from '../src/modules/graduates/graduates.service'
import type { NotificationsService } from '../src/modules/notifications/notifications.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'

/**
 * Security check 19.11, finding №1: a graduate card in an announcement must not be read without its row in the journal.
 *
 * In «Студенты» every card a company sees is written to the audit log and counted in the daily limit before the answer
 * leaves (CompanyStudentsService.account). The same cards — name, «о себе», region, certificates, courses — come out of an
 * announcement (`GET /announcements/:id`, and the answers of «Откликнуться» and «Пригласить») with neither: a company can
 * read them again and again, unseen and unlimited.
 *
 * The rule, for every path: each card it returns has at least one row written by that request in the same shape as
 * «Студенты» writes — action `*.card.view`, entityType `User`, entityId the student's account, `after.companyId` the
 * company — and is counted in the same daily limit (CompanyStudentCardView); over the limit no card leaves. A path may
 * also answer without cards: then there is nothing to write. Reading the same card twice in one request (as «Пригласить»
 * does to find the student) may be charged twice — the rule asks for at least, not exactly.
 *
 * KNOWN_GAP pins today's state per path: the scenario must still work (the journal helper is proven against «Студенты»,
 * the announcement does hand out cards), and the rule must still be broken. Close a path → its test fails and says to
 * take it out of KNOWN_GAP; from then on the rule is demanded there.
 */
const KNOWN_GAP = new Set(['companyGet', 'respond', 'invite', 'limit'])

const SRC = join(__dirname, '../src')
const SERVICE = join(SRC, 'modules/graduates/graduates.service.ts')
/** The GraduatesService methods whose answer carries graduate cards — each is checked against the journal below. */
const CARD_PATHS = ['companyGet', 'invite', 'respond']

/** Holds, or is a known gap of that path — and says what to do when the gap is closed. */
function rule(path: string, holds: boolean, what: string) {
  if (KNOWN_GAP.has(path)) expect(holds, `${what} — now holds: finding №1 is closed here, remove '${path}' from KNOWN_GAP in this file`).toBe(false)
  else expect(holds, what).toBe(true)
}

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === 'generated' ? [] : sourceFiles(p)
    return p.endsWith('.ts') ? [p] : []
  })

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
    const cardsCalledIn = new Set<string>()
    let method = ''
    for (const line of lines) {
      // A method, or a class-property arrow function (`private x = (…) =>`), opens a new owner for the calls below it.
      const head = /^ {2}(?:(?:public|private|protected|readonly|static) )*(?:async )?(\w+)\s*(?:\(|=\s*(?:async\s*)?\()/.exec(line)
      if (head && !['if', 'for', 'while', 'switch', 'return', 'constructor'].includes(head[1])) method = head[1]
      for (const call of line.matchAll(/this\.(?:companyAnnouncement|companyView)\(/g)) {
        const flag = lastArg(line, call.index + call[0].length - 1)
        // companyAnnouncement(…, true) / companyView(…, true): the announcement with its graduates. The one pass-through
        // is companyAnnouncement handing its own flag on; anything else that is not a literal is refused, to be looked at.
        if (flag === 'true') withCards.add(method)
        else if (flag !== 'false' && !(method === 'companyAnnouncement' && flag === 'withGraduates')) withCards.add(`${method} (flag: ${flag})`)
      }
      if (/this\.cards\(/.test(line)) cardsCalledIn.add(method)
    }
    expect([...withCards].sort()).toEqual(CARD_PATHS)
    // The cards are built only through companyView — nothing reaches them past the paths above.
    expect([...cardsCalledIn]).toEqual(['companyView'])
  })

  it('graduate cards are built nowhere else in the API', () => {
    const users = sourceFiles(SRC).filter((f) => /\bGraduateCardDto\b/.test(readFileSync(f, 'utf8')))
    expect(users.map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))).toEqual(['modules/graduates/graduates.service.ts'])
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
  const section = new CompanyStudentsService(ctx.prisma, ctx.audit, contacts, ctx.env)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const YEAR = new Date().getUTCFullYear()

  /**
   * A published IT announcement of an approved institution; two confirmed adult graduates who show their card both in
   * announcements and in «Студенты»; an approved IT company.
   */
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
          data: {
            tenantId, userId: u.id, mode: 'STUDYING', institutionType: 'TECHNIKUM', institutionId: inst.id, course: 3, graduationYear: YEAR, directionId: direction.id,
            birthDate: new Date(`${YEAR - 20}-05-01T00:00:00Z`), regionId: tashkent.id, about: 'Python', studyConfirmation: 'CONFIRMED',
          },
        })
        for (const kind of ['GRADUATE_CARD', 'INDUSTRY_CARD'] as const) await db.studentConsent.create({ data: { tenantId, userId: u.id, kind, textVersion: 'v1' } })
        userByName.set(name, u.id)
      }
      const draft = await service.create(tenantId, instActor, { year: YEAR, lines: [{ directionId: direction.id, count: 40 }] })
      const ann = await service.publish(tenantId, instActor, draft.id)

      /** This company's card views in the journal (students' account ids, sorted) and the cards counted in its daily limit. */
      const journal = async () => ({
        views: (await db.auditEvent.findMany({ where: { action: { endsWith: 'card.view' }, entityType: 'User' }, select: { entityId: true, after: true }, orderBy: { id: 'asc' } }))
          .filter((v) => (v.after as { companyId?: string } | null)?.companyId === co.id).map((v) => v.entityId as string).sort(),
        counted: (await db.companyStudentCardView.aggregate({ where: { companyId: co.id }, _sum: { cards: true } }))._sum.cards ?? 0,
      })

      /**
       * Runs one path and tells whether the cards it returned came out with their rows: every returned card's student has
       * a row written by this request, and at least as many cards were counted. An answer without cards holds trivially.
       */
      const read = async (path: () => Promise<{ graduates?: { name: unknown }[] }>) => {
        const before = await journal()
        const dto = await path()
        const after = await journal()
        const shown = (dto.graduates ?? []).map((g) => userByName.get(g.name as string))
        expect(shown.every(Boolean), 'every card returned is one of the graduates').toBe(true)
        const written = after.views.slice()
        for (const v of before.views) {
          const i = written.indexOf(v)
          expect(i, 'journal rows never disappear').toBeGreaterThanOrEqual(0)
          written.splice(i, 1)
        }
        return { shown: shown.length, written: shown.every((u) => written.includes(u!)), counted: after.counted - before.counted >= shown.length }
      }
      return { tenantId, inT, db, inst, ann, company, userByName, journal, read }
    })
  }
  type Setup = Awaited<ReturnType<typeof setup>>

  /** The announcement does hand the company both cards — so a rule that «holds» below is not an empty setup. */
  const handsOutCards = async (s: Setup) => {
    const names = (await service.companyGet(s.company.actor, s.ann.id)).graduates?.map((g) => g.name).sort()
    expect(names, 'the announcement shows both graduates').toEqual(['Aziz', 'Bobur'])
  }

  it('the journal helper sees exactly what «Студенты» writes for a card shown', async () => {
    const s = await setup('acj-control')
    await s.inT(async () => {
      expect(await s.journal()).toEqual({ views: [], counted: 0 })
      const page = await section.page(s.company.actor, s.inst.id, {}, 1)
      expect(page.items.map((c) => c.name).sort()).toEqual(['Aziz', 'Bobur'])
      expect(await s.journal()).toEqual({ views: [s.userByName.get('Aziz'), s.userByName.get('Bobur')].sort(), counted: 2 })
    })
  })

  it('GET /announcements/:id: every card has its row in the journal and is counted in the daily limit', async () => {
    const s = await setup('acj-get')
    await s.inT(async () => {
      const r = await s.read(() => service.companyGet(s.company.actor, s.ann.id))
      expect(r.shown, 'GET /announcements/:id hands out the cards').toBe(2)
      rule('companyGet', r.written && r.counted, 'GET /announcements/:id writes a card view for every card it returns and counts them in the daily limit')
    })
  })

  it('«Откликнуться» (POST /announcements/:id/responses): any card in its answer is written and counted too', async () => {
    const s = await setup('acj-respond')
    await s.inT(async () => {
      await handsOutCards(s)
      // The line id comes from the list — it carries no cards.
      const [visible] = await service.companyList(s.company.actor, {})
      expect(visible.graduates, 'the list hands out no cards').toBeUndefined()
      const r = await s.read(() => service.respond(s.tenantId, s.company.actor, s.ann.id, { lines: [{ lineId: visible.lines[0].id, wantedCount: 1 }], comment: null }))
      rule('respond', r.written && r.counted, '«Откликнуться» writes and counts the cards of its answer (or answers without cards)')
    })
  })

  it('«Пригласить» (POST /graduates/:cardId/invite): any card in its answer is written and counted too', async () => {
    const s = await setup('acj-invite')
    await s.inT(async () => {
      await handsOutCards(s)
      const cardId = (await service.companyGet(s.company.actor, s.ann.id)).graduates!.find((g) => g.name === 'Aziz')!.cardId
      const r = await s.read(() => service.invite(s.tenantId, s.company.actor, cardId, s.ann.id))
      rule('invite', r.written && r.counted, '«Пригласить» writes and counts the cards of its answer (or answers without cards)')
    })
  })

  it('over the daily limit no card leaves the announcement, and nothing is written', async () => {
    const s = await setup('acj-limit')
    await s.inT(async () => {
      await handsOutCards(s)
      // The company has seen its whole day of cards an hour ago.
      await s.db.companyStudentCardView.create({ data: { companyId: s.company.id, cards: STUDENT_CARDS_PER_DAY, createdAt: new Date(Date.now() - 3_600_000) } })
      const before = await s.journal()
      const answer = await service.companyGet(s.company.actor, s.ann.id).then((dto) => dto, (e: unknown) => e as { code?: string; status?: number })
      const refused = 'status' in answer && answer.status === 429 && answer.code === 'rate_limited'
      const noCards = 'id' in answer && !(answer as { graduates?: unknown[] }).graduates?.length
      expect(refused || 'id' in answer, 'answered or refused with 429 — not any other error').toBe(true)
      if (refused || noCards) expect(await s.journal(), 'nothing is written for cards not shown').toEqual(before)
      rule('limit', refused || noCards, 'over the daily limit GET /announcements/:id hands out no card')
    })
  })
})
