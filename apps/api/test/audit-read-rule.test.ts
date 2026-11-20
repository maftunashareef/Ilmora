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
 *     in READERS with its rule: a new reader fails here until it is classified on purpose.
 *  2. When: signed in with the authenticator (once TOTP_ENCRYPTION_KEY is set) and with no temporary password pending.
 *  3. Every read writes an `audit.read` row: the reader and the filters used — not the rows returned, not other
 *     people's IP or browser. Not built yet (KNOWN_GAP_N9).
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
const READ = /\bauditEvent\s*\.\s*(findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|aggregate|groupBy)\s*\(|FROM\s+"AuditEvent"/g
/** The text of the call that starts at `from`: up to its matching closing parenthesis. */
const callAt = (text: string, from: number) => {
  let depth = 0
  for (let i = text.indexOf('(', from); i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return text.slice(from, i + 1)
  }
  return text.slice(from)
}
const found = filesOf(SRC).flatMap((file) => {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(READ)].map((m) => ({ file: relative(SRC, file).replace(/\\/g, '/'), call: m[0].startsWith('FROM') ? m[0] : callAt(text, m.index) }))
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
const PRIVATE_FIELDS = /\b(ip|userAgent|before|after|requestId|actorRoles)\s*:/

describe('Audit log read rule (№9): the readers', () => {
  it('finds the journal read itself', () => {
    expect(found.filter((f) => f.file === 'modules/manage/manage.service.ts').length).toBeGreaterThanOrEqual(3)
  })

  it('every place that reads AuditEvent rows is listed with its rule', () => {
    const counts: Record<string, number> = {}
    for (const f of found) counts[f.file] = (counts[f.file] ?? 0) + 1
    expect(counts, 'a new reader of the audit log: add it to READERS with who may reach it').toEqual(Object.fromEntries(Object.entries(READERS).map(([k, v]) => [k, v.calls])))
  })

  it('outside the journal a reader selects only harmless fields: no IP, browser or before/after', () => {
    const wrong = found.filter((f) => ['history', 'internal'].includes(READERS[f.file]?.kind ?? '') && (!/\bselect\s*:/.test(f.call) || PRIVATE_FIELDS.test(f.call.slice(f.call.search(/\bselect\s*:/)))))
    expect(wrong.map((f) => `${f.file}: ${f.call.slice(0, 120)}`)).toEqual([])
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
    const block = /enum Role \{([^}]*)\}/.exec(schema)![1].replace(/\/\*\*[\s\S]*?\*\//g, '')
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
type Row = { action: string; actorId: string | null; before?: unknown; after?: unknown; reason?: string | null }
type Filters = Record<string, string | Date>
/** The filters as the row would carry them: in `after` or `after.filters`, dates as ISO text. */
const hasFilters = (after: unknown, q: Filters) => {
  const a = (after ?? {}) as Record<string, unknown>
  const o = (a.filters ?? a) as Record<string, unknown>
  return Object.entries(q).every(([k, v]) => o[k] !== undefined && String(o[k] instanceof Date ? (o[k] as Date).toISOString() : o[k]) === (v instanceof Date ? v.toISOString() : v))
}
/** One audit.read row by the reader, with the filters, and nothing of the rows it returned. */
const readLogged = (rows: Row[], actor: RequestActor, q: Filters, secrets: string[]) => {
  const reads = rows.filter((r) => r.action === 'audit.read')
  if (reads.length !== 1) return false
  const [r] = reads
  const text = JSON.stringify({ before: r.before ?? null, after: r.after ?? null, reason: r.reason ?? null })
  return r.actorId === actor.id && hasFilters(r.after, q) && secrets.every((s) => !text.includes(s))
}
const controllerOf = (manage: ManageService) => new ManageController(manage, {} as unknown as SiteService, {} as Queue, {} as Queue, {} as Queue)

describe('Audit log read rule (№9): a read is written to the log', () => {
  const OTHER_IP = '203.0.113.77', OTHER_UA = 'OtherPersonBrowser/9.9'
  const setup = () => {
    const written: Row[] = []
    const reads: unknown[] = []
    const event = { id: 'ev-of-someone', tenantId: 't', actorId: 'rep', action: 'student.card.view', entityType: 'User', entityId: 'student', ip: OTHER_IP, userAgent: OTHER_UA, after: { companyId: 'co' }, createdAt: new Date(), actor: null }
    const auditEvent = {
      findMany: async (args: { where: unknown }) => (reads.push(args.where), [event]),
      count: async () => 1,
      create: async ({ data }: { data: Row }) => (written.push(data), data),
      createMany: async ({ data }: { data: Row[] }) => (written.push(...data), { count: data.length }),
    }
    const prisma = { client: { auditEvent, $transaction: async (fn: (tx: unknown) => unknown) => fn({ auditEvent }) } } as unknown as PrismaService
    const manage = new ManageService(prisma, new AuditService(prisma), {} as unknown as SessionsService, {} as unknown as SiteService, notificationsStub, {} as unknown as Env)
    return { controller: controllerOf(manage), written, reads, event }
  }
  const asReader = <T>(actor: RequestActor, fn: () => Promise<T>) => TenantContext.forTenant('t', fn, { actor, ip: '198.51.100.1', userAgent: 'ReaderBrowser/1.0' })

  it('the Super Admin\'s read: one audit.read row with the reader and the filters', async () => {
    const s = setup()
    const q = { entityType: 'User', entityId: 'student', action: 'student.card.view', from: new Date('2026-11-01T00:00:00Z') }
    const out = await asReader(superAdmin, () => s.controller.audit('t', superAdmin, q))
    // The read itself happened and returned the row: a broken setup fails here, not in the rule.
    expect(s.reads).toHaveLength(1)
    expect(out.items).toEqual([s.event])
    rule(readLogged(s.written, superAdmin, q, [OTHER_IP, OTHER_UA, s.event.id]), 'GET /admin/audit writes audit.read with the reader and the filters, not the returned rows')
  })

  it('a finance admin\'s read is written too', async () => {
    const s = setup()
    const q = { entityType: 'Payment' }
    await asReader(finance, () => s.controller.audit('t', finance, q))
    expect(s.reads).toEqual([{ tenantId: 't', entityType: 'Payment' }])
    rule(readLogged(s.written, finance, q, [OTHER_IP, OTHER_UA, s.event.id]), 'a finance admin\'s read of the log writes audit.read')
  })
})

describe.skipIf(!DB_AVAILABLE)('Audit log read rule (№9): a read is written to the log (PostgreSQL)', () => {
  const ctx = new TestContext()
  const manage = new ManageService(ctx.prisma, ctx.audit, {} as unknown as SessionsService, {} as unknown as SiteService, notificationsStub, ctx.env)
  const controller = controllerOf(manage)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('reading «who saw this student» leaves an audit.read row with the reader and the filters, without the other person\'s IP or browser', async () => {
    const { tenantId } = await ctx.makeTenant('arr')
    const db = ctx.prisma.client
    const OTHER_IP = '203.0.113.88', OTHER_UA = 'OtherPersonBrowser/8.8'
    await TenantContext.forTenant(tenantId, async () => {
      const student = await ctx.makeStudent(tenantId)
      const reader = await db.user.create({ data: { tenantId, login: `sa-${tenantId}`, displayName: 'Owner', roles: [], isOwner: true } })
      const sa: RequestActor = { id: reader.id, roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] }
      const seen = await db.auditEvent.create({ data: { tenantId, actorRoles: ['COMPANY_ADMIN'], action: 'student.card.view', entityType: 'User', entityId: student.id, after: { companyId: 'co-x' }, ip: OTHER_IP, userAgent: OTHER_UA }, select: { id: true } })
      const q = { entityType: 'User', entityId: student.id, from: new Date(Date.now() - 3_600_000) }
      const out = await TenantContext.forTenant(tenantId, () => controller.audit(tenantId, sa, q), { actor: sa, ip: '198.51.100.2', userAgent: 'ReaderBrowser/2.0' })
      expect(out.items.map((e) => e.id)).toEqual([seen.id])
      const rows = await db.auditEvent.findMany({ where: { tenantId, action: 'audit.read' }, select: { action: true, actorId: true, before: true, after: true, reason: true } })
      rule(readLogged(rows, sa, q, [OTHER_IP, OTHER_UA, seen.id]), 'GET /admin/audit writes audit.read (PostgreSQL)')
    })
  })
})
