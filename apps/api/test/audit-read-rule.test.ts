import 'reflect-metadata'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Queue } from 'bullmq'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { AuthGuard, PasswordChangeGuard, RolesGuard } from '../src/common/guards'
import type { Env } from '../src/config/env'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import { AuditService } from '../src/modules/audit/audit.service'
import { AccountService } from '../src/modules/auth/account.service'
import { MfaService } from '../src/modules/auth/mfa.service'
import { ManageController } from '../src/modules/manage/manage.controller'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'
import { type Route, routesOf } from './support/routes'

/**
 * Security check 19.11 №9: who may read the audit log, when, and that a read is itself written to the log.
 *
 *  1. Who: GET /admin/audit lets in the Super Admin (everything) and a finance admin (the money records only, ТЗ 9.4 —
 *     scope in audit-access.test.ts); every other role is 403. Every place in src/ that reads AuditEvent rows is listed
 *     in READERS with its rule: a new reader fails here until it is classified on purpose. The check counts reads per
 *     file, so a reader swapped for another in the same file is not seen — review such a change by hand.
 *  2. When: signed in with the authenticator (once TOTP_ENCRYPTION_KEY is set) and with no temporary password pending.
 *  3. Every read that reaches the service writes one `audit.read` row: actorId = the reader, and the filters used in
 *     `after` or `after.filters` — only the query's keys (entityType, entityId, action, actorId, companyId, from, to as
 *     ISO text, page, pageSize), never the rows returned or other people's IP or browser. A read the finance scope
 *     answers empty is an attempt and is written too. A request refused before the service (403 by role, 400 by a bad
 *     filter) writes nothing. The write must live in ManageService.audits or ManageController.audit: these tests call
 *     the controller method, so an interceptor would not be seen.
 *
 * Not built yet (KNOWN_GAP_N9): while open, the check is the weak one — no `audit.*` row is written by a read — so any
 * shape of the fix trips the alarm; the strict shape above applies once the flag is false.
 */
const KNOWN_GAP_N9 = true // finding №9 open; when GET admin/audit writes audit.read, set false
function rule(holds: boolean, what: string) {
  if (KNOWN_GAP_N9) expect(holds, `${what} — now holds: №9 closed, set KNOWN_GAP_N9 = false`).toBe(false)
  else expect(holds, what).toBe(true)
}

const ROLES = ['PLATFORM_ADMIN', 'FINANCE_ADMIN', 'CENTER_ADMIN', 'TEACHER', 'STUDENT', 'INSTITUTION_ADMIN', 'COMPANY_ADMIN', 'MINISTRY'] as const
const JOURNAL_READERS = ['PLATFORM_ADMIN', 'FINANCE_ADMIN']
const superAdmin: RequestActor = { id: 'sa', roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] }
const finance: RequestActor = { id: 'fin', roles: ['FINANCE_ADMIN'] }

// ── 1. Every reader of AuditEvent in src/ ──
const SRC = join(__dirname, '../src')
const filesOf = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  if (statSync(p).isDirectory()) return n === 'generated' ? [] : filesOf(p)
  return p.endsWith('.ts') ? [p] : []
})
const METHODS = 'findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|aggregate|groupBy'
const READ = new RegExp(`(?:\\bauditEvent|\\[\\s*['"\`]auditEvent['"\`]\\s*\\])\\s*\\.\\s*(${METHODS})\\s*\\(|\\b(?:from|join)\\s+"AuditEvent"|\\bauditEvents\\s*:`, 'gi')
/** From `from` to the bracket that closes the first one opened after it. */
const balanced = (text: string, from: number, open = '(', close = ')') => {
  let depth = 0
  for (let i = text.indexOf(open, from); i >= 0 && i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close && --depth === 0) return text.slice(from, i + 1)
  }
  return text.slice(from)
}
/** Top-level `key: value` pairs of the call's first object argument. */
const topLevel = (call: string) => {
  const arg = balanced(call, call.indexOf('('), '{', '}')
  const out: Record<string, string> = {}
  let depth = 0
  for (let i = arg.indexOf('{'); i < arg.length; i++) {
    const c = arg[i]
    if ('{[('.includes(c)) depth++
    else if ('}])'.includes(c)) depth--
    else if (depth === 1) {
      const m = /^(\.\.\.|[A-Za-z_$][\w$]*)\s*:?/.exec(arg.slice(i))
      if (m && (m[1] === '...' || m[0].endsWith(':'))) {
        const start = i + m[0].length
        let d = 0, j = start
        for (; j < arg.length; j++) {
          if ('{[('.includes(arg[j])) d++
          else if ('}])'.includes(arg[j])) { if (d === 0) break; d-- }
          else if (arg[j] === ',' && d === 0) break
        }
        out[m[1]] = arg.slice(start, j)
        i = j - 1
      }
    }
  }
  return out
}
const found = filesOf(SRC).flatMap((file) => {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(READ)].map((m) => ({ file: relative(SRC, file).replace(/\\/g, '/'), method: m[1] ?? 'raw-or-relation', call: m[1] ? balanced(text, m.index) : m[0] }))
})

type Reader = { calls: number; kind: 'journal' | 'history' | 'internal' | 'cli'; rule: string }
/**
 * Every reader, by file. `journal` returns whole rows (IP, browser, before/after): GET /admin/audit only. `history`
 * returns a narrow slice to a Super Admin route. `internal` turns rows into a decision or a time and returns no row.
 * `cli` is a server command, no HTTP.
 */
const READERS: Record<string, Reader> = {
  'modules/manage/manage.service.ts': { calls: 4, kind: 'journal', rule: 'GET /admin/audit (ManageService.audits): Super Admin all, finance admin money records; must write audit.read (№9)' },
  'modules/companies/company-review.service.ts': { calls: 1, kind: 'history', rule: 'GET /admin/companies/:id: Super Admin only; review actions with reason, time and actor name' },
  'modules/institutions/institution-review.service.ts': { calls: 1, kind: 'history', rule: 'GET /admin/institutions/:id: Super Admin only; review actions with reason, time and actor name' },
  'modules/auth/account.service.ts': { calls: 2, kind: 'internal', rule: 'issued password not changed yet → token claim; returns no row' },
  'modules/institutions/institutions.service.ts': { calls: 1, kind: 'internal', rule: 'time of the claim, for releasing an abandoned draft' },
  'modules/registry/registry.mappers.ts': { calls: 1, kind: 'internal', rule: 'time of the last edit (lastEdit)' },
  'cli/purge-demo.ts': { calls: 3, kind: 'cli', rule: 'demo purge counts rows before deleting them' },
}
/** Fields no reader but the journal may hand out. */
const PRIVATE = /\b(ip|userAgent|before|after|requestId|actorRoles)\b/
/** What is wrong with a history or internal read, or null. */
const unsafe = (f: (typeof found)[number]): string | null => {
  if (f.method === 'raw-or-relation') return 'raw SQL or a relation read'
  if (f.method === 'count') return Object.keys(topLevel(f.call)).some((k) => k === 'select' || k === '...') ? 'count with select' : null
  if (f.method === 'groupBy' || f.method === 'aggregate') return PRIVATE.test(f.call) ? `${f.method} by a private field` : null
  const top = topLevel(f.call)
  if ('include' in top) return 'include: (whole related rows)'
  if ('...' in top) return 'spread arguments'
  if (!('select' in top)) return 'no top-level select (whole rows)'
  if (top.select.includes('...')) return 'spread in select'
  if (PRIVATE.test(top.select)) return 'private field in select'
  return null
}

describe('Audit log read rule (№9): the readers', () => {
  it('every place that reads AuditEvent rows is listed with its rule', () => {
    const counts: Record<string, number> = {}
    for (const f of found) counts[f.file] = (counts[f.file] ?? 0) + 1
    expect(counts, 'a new reader of the audit log: add it to READERS with who may reach it').toEqual(Object.fromEntries(Object.entries(READERS).map(([k, v]) => [k, v.calls])))
  })

  it('outside the journal a reader selects only harmless fields: no IP, browser or before/after, no include or spread', () => {
    const wrong = found.filter((f) => ['history', 'internal'].includes(READERS[f.file]?.kind ?? '')).map((f) => [f, unsafe(f)] as const).filter(([, why]) => why)
    expect(wrong.map(([f, why]) => `${f.file}: ${why}: ${f.call.slice(0, 120)}`)).toEqual([])
  })

  it('the harmless-fields check refuses the unsafe shapes', () => {
    const call = (method: string, text: string) => ({ file: 'x', method, call: `auditEvent.${method}(${text})` })
    expect(unsafe(call('findMany', `{ where: { entityId: id }, select: { createdAt: true, actor: { select: { displayName: true } } } }`))).toBeNull()
    expect(unsafe(call('findFirst', `{ where: { id }, select: { createdAt: true } }`))).toBeNull()
    expect(unsafe(call('findMany', `{ where: { id }, include: { actor: true } }`))).toMatch(/include/)
    expect(unsafe(call('findMany', `{ where: { id }, include: { actor: { select: { id: true } } } }`))).toMatch(/include/)
    expect(unsafe(call('findMany', `{ where: { id } }`))).toMatch(/no top-level select/)
    expect(unsafe(call('findMany', `{ where: { id }, select: { ...ALL } }`))).toMatch(/spread in select/)
    expect(unsafe(call('findMany', `{ ...args }`))).toMatch(/spread/)
    expect(unsafe(call('findMany', `{ where: { id }, select: { ip: true } }`))).toMatch(/private/)
    expect(unsafe(call('groupBy', `{ by: ['userAgent'], _count: true }`))).toMatch(/private/)
    expect(unsafe({ file: 'x', method: 'raw-or-relation', call: 'FROM "AuditEvent"' })).toMatch(/raw/)
    expect(`x.auditEvent.findMany(a); x['auditEvent'].count(); SELECT 1 from "AuditEvent"; JOIN "AuditEvent"; include: { auditEvents: true }`.match(READ)).toHaveLength(5)
  })
})

// ── 1. Who, on the routes ──
const ALL = routesOf(AppModule)
const key = (r: Pick<Route, 'method' | 'path'>) => `${r.method} ${r.path}`
const route = (k: string) => {
  const r = ALL.find((x) => key(x) === k)
  if (!r) throw new Error(`no route ${k}`)
  return r
}
const contextFor = (r: Route, actor: RequestActor | undefined) =>
  ({ getHandler: () => r.handler, getClass: () => r.cls, switchToHttp: () => ({ getRequest: () => ({ actor }) }) }) as unknown as ExecutionContext
const status = (fn: () => boolean) => { try { return fn() ? 200 : 403 } catch (err) { return (err as { getStatus?: () => number }).getStatus?.() ?? 500 } }
const reflector = new Reflector()
const roles = new RolesGuard(reflector), auth = new AuthGuard(reflector), pwc = new PasswordChangeGuard(reflector)

describe('Audit log read rule (№9): who and when', () => {
  it('the roles list is the schema\'s', () => {
    const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8')
    const block = /enum Role \{([^}]*)\}/.exec(schema)![1].replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(block.split(/\s+/).filter(Boolean)).toEqual([...ROLES])
  })

  it('GET /admin/audit: the Super Admin and a finance admin; any other role 403, no session 401', () => {
    const r = route('GET /admin/audit')
    expect(r.public).toBe(false)
    expect(r.roles).toEqual(JOURNAL_READERS)
    for (const role of ROLES) expect(status(() => roles.canActivate(contextFor(r, { id: 'u', roles: [role] }))), role).toBe(JOURNAL_READERS.includes(role) ? 200 : 403)
    expect(status(() => roles.canActivate(contextFor(r, { id: 'u', roles: ['TEACHER', 'CENTER_ADMIN', 'COMPANY_ADMIN', 'MINISTRY'] })))).toBe(403)
    expect(status(() => auth.canActivate(contextFor(r, undefined)))).toBe(401)
  })

  it('the review history: the Super Admin only', () => {
    for (const k of ['GET /admin/companies/:id', 'GET /admin/institutions/:id']) {
      const r = route(k)
      expect(r.roles, k).toEqual(['PLATFORM_ADMIN'])
      for (const role of ROLES) expect(status(() => roles.canActivate(contextFor(r, { id: 'u', roles: [role] }))), `${k} ${role}`).toBe(role === 'PLATFORM_ADMIN' ? 200 : 403)
    }
  })

  it('the Super Admin role comes from the owner flag only, never from the roles column', async () => {
    const effective = AccountService.prototype.effectiveRoles
    expect(await effective({ roles: ['PLATFORM_ADMIN', 'TEACHER'], isOwner: false })).toEqual(['TEACHER'])
    expect(await effective({ roles: [], isOwner: true })).toEqual(['PLATFORM_ADMIN', 'FINANCE_ADMIN'])
  })

  it('when: the readers sign in with the authenticator once the key is set; a temporary password closes the log', () => {
    const mfa = (key?: string) => new MfaService({} as never, {} as never, {} as never, {} as never, { TOTP_ENCRYPTION_KEY: key } as unknown as Env)
    expect(mfa('k').enforced({ roles: [], isOwner: true })).toBe(true)
    expect(mfa('k').enforced({ roles: ['FINANCE_ADMIN'], isOwner: false })).toBe(true)
    // Without the key the Super Admin signs in on the password alone (logged as a warning) — a deployment setting.
    expect(mfa(undefined).enforced({ roles: [], isOwner: true })).toBe(false)
    const r = route('GET /admin/audit')
    expect(status(() => pwc.canActivate(contextFor(r, { ...superAdmin, passwordChangeRequired: true })))).toBe(403)
    expect(status(() => pwc.canActivate(contextFor(r, superAdmin)))).toBe(200)
  })
})

// ── 3. A read writes audit.read ──
type Row = { action: string; actorId: string | null; before?: unknown; after?: unknown; reason?: string | null; ip?: string | null }
type Filters = Record<string, string | Date>
const FILTER_KEYS = ['entityType', 'entityId', 'action', 'actorId', 'companyId', 'from', 'to', 'page', 'pageSize']
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))
/** The filters as the row carries them: in `after` or `after.filters`; only the query's keys, each asked one equal. */
const hasFilters = (after: unknown, q: Filters) => {
  const a = (after ?? {}) as Record<string, unknown>
  const o = (a.filters ?? a) as Record<string, unknown>
  return Object.keys(o).every((k) => FILTER_KEYS.includes(k)) && Object.entries(q).every(([k, v]) => o[k] !== undefined && iso(o[k]) === iso(v))
}
const READER_IP = '198.51.100.1', READER_UA = 'ReaderBrowser/1.0'
/** One audit.read row by the reader, with the filters, from the reader's address, and nothing of the rows returned. */
const readLogged = (rows: Row[], actor: RequestActor, q: Filters, secrets: string[]) => {
  const reads = rows.filter((r) => r.action === 'audit.read')
  if (reads.length !== 1) return false
  const [r] = reads
  const text = JSON.stringify({ before: r.before ?? null, after: r.after ?? null, reason: r.reason ?? null })
  return r.actorId === actor.id && (r.ip == null || r.ip === READER_IP) && hasFilters(r.after, q) && secrets.every((s) => !text.includes(s))
}
/** While №9 is open: no audit.* row at all (any shape of the fix trips it); then the strict shape. */
const readRule = (rows: Row[], actor: RequestActor, q: Filters, secrets: string[], what: string) =>
  rule(KNOWN_GAP_N9 ? rows.some((r) => r.action.startsWith('audit.')) : readLogged(rows, actor, q, secrets), what)
const controllerOf = (manage: ManageService) => new ManageController(manage, {} as unknown as SiteService, {} as Queue, {} as Queue, {} as Queue)

describe('Audit log read rule (№9): a read is written to the log', () => {
  const OTHER_IP = '203.0.113.77', OTHER_UA = 'OtherPersonBrowser/9.9'
  const setup = () => {
    const written: Row[] = []
    const reads: unknown[] = []
    const raws: unknown[][] = []
    const event = { id: 'ev-of-someone', tenantId: 't', actorId: 'rep', action: 'student.card.view', entityType: 'User', entityId: 'student', ip: OTHER_IP, userAgent: OTHER_UA, after: { companyId: 'co' }, createdAt: new Date(), actor: null }
    const auditEvent = {
      findMany: async (args: { where: unknown }) => (reads.push(args.where), [event]),
      count: async () => 1,
      create: async ({ data }: { data: Row }) => (written.push(data), data),
      createMany: async ({ data }: { data: Row[] }) => (written.push(...data), { count: data.length }),
    }
    const client = {
      auditEvent,
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => (raws.push(params), sql.startsWith('SELECT count') ? [{ n: 1 }] : [{ id: event.id }]),
      $transaction: async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client)),
    }
    const prisma = { client } as unknown as PrismaService
    const manage = new ManageService(prisma, new AuditService(prisma), {} as unknown as SessionsService, {} as unknown as SiteService, notificationsStub, {} as unknown as Env)
    return { controller: controllerOf(manage), written, reads, raws, event, secrets: [OTHER_IP, OTHER_UA, event.id] }
  }
  const asReader = <T>(actor: RequestActor, fn: () => Promise<T>) => TenantContext.forTenant('t', fn, { actor, ip: READER_IP, userAgent: READER_UA })

  it('the Super Admin\'s read: one audit.read row with the reader and the filters', async () => {
    const s = setup()
    const q = { entityType: 'User', entityId: 'student', action: 'student.card.view', from: new Date('2026-11-01T00:00:00Z') }
    const out = await asReader(superAdmin, () => s.controller.audit('t', superAdmin, q))
    // The read itself happened and returned the row: a broken setup fails here, not in the rule.
    expect(s.reads).toHaveLength(1)
    expect(out.items).toEqual([s.event])
    readRule(s.written, superAdmin, q, s.secrets, 'GET /admin/audit writes audit.read with the reader and the filters, not the returned rows')
  })

  it('by company (the SQL branch): the row carries the companyId', async () => {
    const s = setup()
    const q = { companyId: 'co', action: 'student.card.view' }
    const out = await asReader(superAdmin, () => s.controller.audit('t', superAdmin, q))
    expect(s.raws).toHaveLength(2)
    expect(out.items).toEqual([s.event])
    readRule(s.written, superAdmin, q, s.secrets, 'GET /admin/audit?companyId= writes audit.read with the companyId')
  })

  it('a finance admin\'s read is written too', async () => {
    const s = setup()
    const q = { entityType: 'Payment' }
    await asReader(finance, () => s.controller.audit('t', finance, q))
    expect(s.reads).toEqual([expect.objectContaining({ tenantId: 't', entityType: 'Payment' })])
    readRule(s.written, finance, q, s.secrets, 'a finance admin\'s read of the log writes audit.read')
  })

  it('a finance admin asking for a non-money entity reads nothing, but the attempt is written', async () => {
    const s = setup()
    const q = { entityType: 'User', entityId: 'student' }
    expect(await asReader(finance, () => s.controller.audit('t', finance, q))).toMatchObject({ total: 0, items: [] })
    expect(s.reads).toEqual([])
    expect(s.raws).toEqual([])
    readRule(s.written, finance, q, s.secrets, 'an attempt outside the finance scope writes audit.read')
  })

  it('the filter check refuses a row that logs the whole raw query or a wrong value', () => {
    const q = { entityType: 'User', from: new Date('2026-11-01T00:00:00Z') }
    expect(hasFilters({ filters: { entityType: 'User', from: '2026-11-01T00:00:00.000Z' } }, q)).toBe(true)
    expect(hasFilters({ entityType: 'User', from: '2026-11-01T00:00:00.000Z', page: 2 }, q)).toBe(true)
    expect(hasFilters({ entityType: 'User', from: '2026-11-01T00:00:00.000Z', ip: OTHER_IP }, q)).toBe(false)
    expect(hasFilters({ filters: { entityType: 'User', from: '2026-11-01T00:00:00.000Z', items: [] } }, q)).toBe(false)
    expect(hasFilters({ entityType: 'Payment', from: '2026-11-01T00:00:00.000Z' }, q)).toBe(false)
    expect(readLogged([{ action: 'audit.read', actorId: 'sa', after: q, ip: OTHER_IP }], superAdmin, q, [])).toBe(false)
    expect(readLogged([{ action: 'audit.read', actorId: 'sa', after: q, ip: READER_IP }], superAdmin, q, [])).toBe(true)
  })
})

describe.skipIf(!DB_AVAILABLE)('Audit log read rule (№9): a read is written to the log (PostgreSQL)', () => {
  const ctx = new TestContext()
  const manage = new ManageService(ctx.prisma, ctx.audit, {} as unknown as SessionsService, {} as unknown as SiteService, notificationsStub, ctx.env)
  const controller = controllerOf(manage)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('«who saw this student» and «what company Y saw»: each read leaves an audit.read row with the reader and the filters, without the other person\'s IP or browser', async () => {
    const { tenantId } = await ctx.makeTenant('arr')
    const db = ctx.prisma.client
    const OTHER_IP = '203.0.113.88', OTHER_UA = 'OtherPersonBrowser/8.8'
    await TenantContext.forTenant(tenantId, async () => {
      const student = await ctx.makeStudent(tenantId)
      const reader = await db.user.create({ data: { tenantId, login: `sa-${tenantId}`, displayName: 'Owner', roles: [], isOwner: true } })
      const sa: RequestActor = { id: reader.id, roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] }
      const companyId = `co-${tenantId}`
      const seen = await db.auditEvent.create({ data: { tenantId, actorRoles: ['COMPANY_ADMIN'], action: 'student.card.view', entityType: 'User', entityId: student.id, after: { companyId }, ip: OTHER_IP, userAgent: OTHER_UA }, select: { id: true } })
      const secrets = [OTHER_IP, OTHER_UA, seen.id]
      const asSa = <T>(fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn, { actor: sa, ip: READER_IP, userAgent: READER_UA })
      const auditRows = () => db.auditEvent.findMany({ where: { tenantId, action: { startsWith: 'audit.' } }, orderBy: { createdAt: 'asc' }, select: { id: true, action: true, actorId: true, before: true, after: true, reason: true, ip: true } })
      const notAudit = (items: { action: string; id: string }[]) => items.filter((e) => !e.action.startsWith('audit.')).map((e) => e.id)

      const byStudent = { entityType: 'User', entityId: student.id, from: new Date(Date.now() - 3_600_000) }
      expect(notAudit((await asSa(() => controller.audit(tenantId, sa, byStudent))).items)).toEqual([seen.id])
      readRule(await auditRows(), sa, byStudent, secrets, 'GET /admin/audit writes audit.read (PostgreSQL)')

      const before = (await auditRows()).map((r) => r.id)
      const byCompany = { companyId }
      expect(notAudit((await asSa(() => controller.audit(tenantId, sa, byCompany))).items)).toEqual([seen.id])
      readRule((await auditRows()).filter((r) => !before.includes(r.id)), sa, byCompany, secrets, 'GET /admin/audit?companyId= writes audit.read with the companyId (PostgreSQL)')
    })
  })
})
