import 'reflect-metadata'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ExecutionContext } from '@nestjs/common'
import { HEADERS_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedRegistryReference } from '../prisma/registry-reference'
import { AppModule } from '../src/app.module'
import { RolesGuard } from '../src/common/guards'
import { buildXlsx } from '../src/common/xlsx'
import { Role } from '../src/generated/prisma/enums'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { InstitutionsService } from '../src/modules/institutions/institutions.service'
import { MinistryRegistryService } from '../src/modules/ministry/ministry-registry.service'
import { MinistryStatsService } from '../src/modules/ministry/ministry-stats.service'
import { MinistryController } from '../src/modules/ministry/ministry.controller'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'
import { type Route, routesOf } from './support/routes'
import { unzip } from './support/xlsx'

/**
 * Excel export / import guard (ТЗ 11, 12.4: «Выгрузка Excel — только владелец или менеджер центра, не учитель; каждая
 * выгрузка — в журнале действий: кто, когда, сколько строк»).
 *
 *  1. Every export/import route (by path, or because its handler writes an .xlsx) is listed in EXPORTS with the roles
 *     the real role guard lets in and the audit action it writes. A new one fails here until it is listed on purpose.
 *  2. Center exports (none yet — the ТЗ plans the center's students table): the center passes, the teacher, student and
 *     company get 403. No export/import route lets a teacher in, anywhere.
 *     There is no «center manager» role: Role has CENTER_ADMIN only and the owner is Center.ownerUserId. If a manager
 *     role appears, add it to CENTER_EXPORTERS below.
 *  3. Audit: each listed handler writes its action (structural check of the source text) and, with PostgreSQL, the
 *     ministry download leaves one row with the actor and the number of data rows.
 *  4. Formula safety of the writer for the remaining formula prefixes (@, -).
 *
 * Detection: the path (export, import, excel, xls(x), csv, download), the handler's text (buildXlsx, spreadsheetml,
 * text/csv) or a @Header content type (spreadsheetml, csv, octet-stream); and, per file, any spreadsheet/CSV writer.
 */

const ALL = routesOf(AppModule)
const key = (r: Pick<Route, 'method' | 'path'>) => `${r.method} ${r.path}`
const SRC = join(__dirname, '..', 'src')
const ROLES = Object.values(Role)

type Scope = 'center' | 'ministry' | 'admin'
type Export = {
  scope: Scope
  allow: Role[]
  audit: string
  /** Files (under src) where the audit call lives, if not in the handler. */
  auditIn?: string[]
}
/** PLATFORM_ADMIN is the Super Admin: RolesGuard lets it through every route. */
const EXPORTS: Record<string, Export> = {
  'GET /ministry/export': { scope: 'ministry', allow: ['MINISTRY', 'PLATFORM_ADMIN'], audit: 'ministry.export' },
}
/** Routes the classifier catches that are not exports, with the reason. Empty today. */
const NOT_EXPORTS: Record<string, string> = {}
/** Files that write a spreadsheet / CSV → the routes they serve. Every export route must be served by one of them. */
const XLSX_WRITERS: Record<string, string[]> = {
  'modules/ministry/ministry.controller.ts': ['GET /ministry/export'],
}

const CENTER_EXPORTERS: Role[] = ['CENTER_ADMIN', 'PLATFORM_ADMIN']
const NOT_CENTER: Role[] = ['TEACHER', 'STUDENT', 'COMPANY_ADMIN']
const CENTER_CONTROLLERS = ['CenterController', 'AdminCenterController']

const EXPORT_PATH = /(export|import|excel|xlsx?|csv|download)/i
const WRITES_XLSX = /buildXlsx|spreadsheetml|text\/csv/
const EXPORT_HEADER = /spreadsheetml|csv|octet-stream/i
const WRITER_SOURCE = /buildXlsx\s*\(|from ['"](exceljs|xlsx)['"]|text\/csv/
type Classified = Pick<Route, 'path' | 'handler'>
/** Export/import by path, by what the handler writes, or by a @Header content type. */
const isExport = (r: Classified) =>
  EXPORT_PATH.test(r.path) || WRITES_XLSX.test(r.handler.toString()) || EXPORT_HEADER.test(JSON.stringify(Reflect.getMetadata(HEADERS_METADATA, r.handler) ?? []))
const DETECTED = ALL.filter((r) => isExport(r) && !(key(r) in NOT_EXPORTS))

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|mts|tsx)$/.test(p) ? [p] : [] })
const SOURCES = files(SRC).filter((p) => !p.includes(join('src', 'generated'))).map((p) => ({ file: relative(SRC, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }))

const contextFor = (r: Route, roles: string[]) =>
  ({ getHandler: () => r.handler, getClass: () => r.cls, switchToHttp: () => ({ getRequest: () => ({ actor: { id: 'u', roles } }) }) }) as unknown as ExecutionContext
const guard = new RolesGuard(new Reflector())
const passes = (r: Route, roles: string[]) => {
  try { return guard.canActivate(contextFor(r, roles)) } catch (err) {
    const status = (err as { getStatus?: () => number }).getStatus?.()
    if (status !== 403) throw new Error(`${key(r)}: ${String(err)} (status ${status})`)
    return false
  }
}
const route = (k: string) => { const r = ALL.find((x) => key(x) === k); if (!r) throw new Error(`route not found: ${k}`); return r }

describe('Excel export / import: the list of routes', () => {
  it('the classifier catches export, import, download and CSV addresses, and @Header content types', () => {
    const fake = (path: string, headers?: { name: string; value: string }[]) => {
      const handler = function plain() { return 1 }
      if (headers) Reflect.defineMetadata(HEADERS_METADATA, headers, handler)
      return { path, handler }
    }
    for (const p of ['/center/students/export', '/center/exports', '/center/students/download', '/center/students.csv', '/center/export-students', '/center/exportStudents', '/center/students/import', '/center/imports'])
      expect(isExport(fake(p)), p).toBe(true)
    expect(isExport(fake('/center/report', [{ name: 'Content-Type', value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }]))).toBe(true)
    expect(isExport(fake('/center/report', [{ name: 'Content-Type', value: 'text/csv' }]))).toBe(true)
    for (const p of ['/center/students', '/center/profile', '/manage/courses/:id', '/admin/centers/:centerId/overview']) expect(isExport(fake(p)), p).toBe(false)
  })

  it('every route that exports or imports, or writes a spreadsheet, is listed', () => {
    expect(ALL.length).toBeGreaterThan(250)
    expect(DETECTED.map(key).sort()).toEqual(Object.keys(EXPORTS).sort())
    expect(Object.keys(NOT_EXPORTS).filter((k) => !ALL.some((r) => key(r) === k))).toEqual([])
  })

  it('only the known files write a spreadsheet or CSV, and each serves listed export routes', () => {
    const found = SOURCES.filter((s) => s.file !== 'common/xlsx.ts' && WRITER_SOURCE.test(s.text)).map((s) => s.file).sort()
    expect(found).toEqual(Object.keys(XLSX_WRITERS).sort())
    const served = Object.values(XLSX_WRITERS).flat()
    expect(served.filter((k) => !(k in EXPORTS)).sort()).toEqual([])
    // An import-only route (reads a file, writes none) would need its reader listed here too.
    expect(Object.keys(EXPORTS).filter((k) => !served.includes(k)).sort()).toEqual([])
    for (const k of served) route(k)
  })

  it('no listed export is public', () => {
    expect(Object.keys(EXPORTS).filter((k) => route(k).public)).toEqual([])
  })

  it('an export of the center workspace or its Super Admin twin has scope center', () => {
    expect(DETECTED.filter((r) => (CENTER_CONTROLLERS.includes(r.controller) || r.path.startsWith('/center/')) && EXPORTS[key(r)]?.scope !== 'center').map(key).sort()).toEqual([])
  })
})

describe('Excel export / import: who passes the role guard', () => {
  it('each route lets in exactly the listed roles, the others get 403', () => {
    const wrong: string[] = []
    for (const [k, e] of Object.entries(EXPORTS))
      for (const role of ROLES) if (passes(route(k), [role]) !== e.allow.includes(role)) wrong.push(`${k} for ${role}`)
    expect(wrong).toEqual([])
  })

  it('no export/import route lets a teacher in (alone or with the student role teachers also carry)', () => {
    expect(DETECTED.filter((r) => passes(r, ['TEACHER']) || passes(r, ['TEACHER', 'STUDENT'])).map(key).sort()).toEqual([])
  })

  it('center exports: the center (and the Super Admin) pass; teacher, student, company get 403', () => {
    // The Super Admin's twin (AdminCenterController) is closed to the center itself (api-access-matrix.test.ts).
    const wrong: string[] = []
    for (const [k, e] of Object.entries(EXPORTS)) {
      if (e.scope !== 'center') continue
      const r = route(k)
      const allowed: Role[] = r.controller === 'AdminCenterController' ? ['PLATFORM_ADMIN'] : CENTER_EXPORTERS
      for (const role of allowed) if (!passes(r, [role])) wrong.push(`${k}: ${role} refused`)
      for (const role of NOT_CENTER) if (passes(r, [role])) wrong.push(`${k}: ${role} let in`)
    }
    expect(wrong).toEqual([])
  })
})

describe('Excel export / import: every download is audited', () => {
  // Structural: the handler (or a listed file) has `action: '<name>'` followed in the same object by `rows:`.
  // The DB check below covers the real row of ministry.export.
  it('each listed handler writes its audit action with the number of rows', () => {
    const missing = Object.entries(EXPORTS).filter(([k, e]) => {
      const re = new RegExp(`action:\\s*['"\`]${e.audit.replace(/\./g, '\\.')}['"\`][^}]*\\brows:`)
      const texts = [route(k).handler.toString(), ...(e.auditIn ?? []).map((f) => SOURCES.find((s) => s.file === f)?.text ?? '')]
      return !texts.some((t) => re.test(t))
    }).map(([k]) => k)
    expect(missing).toEqual([])
  })
})

describe('Excel writer: user text never becomes a formula', () => {
  it('cells starting with =, +, -, @ are inline text; real numbers stay numbers', () => {
    const risky = ['=HYPERLINK("http://x","y")', '+1', '-1', '@x', '=1+1', '-2+3']
    const sheet = unzip(buildXlsx('S', ['A', 'B'], risky.map((v) => [v, -1]))).get('xl/worksheets/sheet1.xml')!
    expect(sheet).not.toContain('<f>')
    risky.forEach((v, i) => expect(sheet).toContain(`<c r="A${i + 2}" t="inlineStr"><is><t xml:space="preserve">${v.replace(/"/g, '&quot;')}</t></is></c>`))
    expect(sheet).toContain('<c r="B2"><v>-1</v></c>')
  })
})

describe.skipIf(!DB_AVAILABLE)('Ministry download audit row: who, which table, how many rows', () => {
  const ctx = new TestContext()
  const stats = new MinistryStatsService(ctx.prisma)
  const registry = new MinistryRegistryService(ctx.prisma, new InstitutionsService(ctx.prisma, ctx.audit, notificationsStub))
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('one row per download with the actor id and after.rows = the data rows of the sheet', async () => {
    const t = await ctx.makeTenant('xlsx-audit')
    await TenantContext.system(() => seedRegistryReference(ctx.prisma.client as never, t.tenantId))
    const user = await TenantContext.system(() => ctx.prisma.client.user.create({ data: { tenantId: t.tenantId, phoneE164: `+99877${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, displayName: 'Ministry', roles: ['MINISTRY'] } }))
    const actor = { id: user.id, roles: ['MINISTRY' as const] }
    await TenantContext.forTenant(t.tenantId, async () => {
      let body: Buffer = Buffer.alloc(0)
      const res = { setHeader: () => undefined, send: (b: Buffer) => { body = b } }
      await new MinistryController(stats, registry, ctx.audit).export({ table: 'institutions_by_region', lang: 'ru' }, res as never)
      const dataRows = (unzip(body).get('xl/worksheets/sheet1.xml')!.match(/<row /g) ?? []).length - 1
      expect(dataRows).toBeGreaterThan(1)
      const events = await ctx.prisma.client.auditEvent.findMany({ where: { tenantId: t.tenantId, action: 'ministry.export' } })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ actorId: actor.id, actorRoles: ['MINISTRY'], entityType: 'StatsTable', entityId: 'institutions_by_region' })
      expect(events[0].after).toMatchObject({ rows: dataRows, lang: 'ru' })
    }, { actor })
  })
})
