import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { registrySearchKey } from '@ilmora/shared'
import { AppModule } from '../src/app.module'
import { RolesGuard } from '../src/common/guards'
import { ApprovedGuard } from '../src/common/registry-access'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'
import { type Route, routesOf } from './support/routes'

/**
 * ТЗ 8 «Тесты доступа» and the matrix of 9.4, checked on every route of the registry rather than one by one:
 * which role each route needs, which ones need an approved organization, and that the real guards enforce it.
 * A new registry route that fits no rule fails here until it is classified on purpose.
 */
const ALL = routesOf(AppModule)
const key = (r: Pick<Route, 'method' | 'path'>) => `${r.method} ${r.path}`

/** Before approval the representative only fills in the questionnaire (ТЗ 4.2, 4.3). */
const INSTITUTION_QUESTIONNAIRE = ['POST /institutions/claim', 'GET /institutions/me', 'PATCH /institutions/me', 'PUT /institutions/me/directions', 'POST /institutions/me/submit']
const COMPANY_QUESTIONNAIRE = ['POST /companies', 'GET /companies/me', 'PATCH /companies/me', 'POST /companies/me/certificate/upload-url', 'POST /companies/me/certificate', 'GET /companies/me/certificate', 'POST /companies/me/submit']
/** The Super Admin's registry tools (ТЗ 9.2) — the older /admin routes of the learning centers are outside the registry. */
const REGISTRY_ADMIN = /^\/admin\/(institutions|companies|ministry-accounts|accounts|directions|industries|registry)(\/|$)/

type Rule = { name: string; match: (r: Route) => boolean; roles: string[]; approved: (r: Route) => string | null }
const RULES: Rule[] = [
  { name: 'Super Admin', match: (r) => REGISTRY_ADMIN.test(r.path), roles: ['PLATFORM_ADMIN'], approved: () => null },
  { name: 'ministry', match: (r) => r.path.startsWith('/ministry'), roles: ['MINISTRY'], approved: () => null },
  {
    name: 'institution', match: (r) => /^\/(institutions|training-requests)(\/|$)/.test(r.path), roles: ['INSTITUTION_ADMIN'],
    approved: (r) => (INSTITUTION_QUESTIONNAIRE.includes(key(r)) ? null : 'institution'),
  },
  {
    name: 'company', match: (r) => /^\/(companies|announcements|graduates|contract-help)(\/|$)/.test(r.path), roles: ['COMPANY_ADMIN'],
    approved: (r) => (COMPANY_QUESTIONNAIRE.includes(key(r)) ? null : 'company'),
  },
  { name: 'student', match: (r) => /^\/(students\/me|vacancies)(\/|$)/.test(r.path), roles: ['STUDENT'], approved: () => null },
  // Reference data: read by anyone signed in; a student, institution or company adds a missing direction, a student an institution.
  { name: 'registry read', match: (r) => r.path.startsWith('/registry') && r.method === 'GET', roles: [], approved: () => null },
  { name: 'registry add direction', match: (r) => key(r) === 'POST /registry/directions', roles: ['STUDENT', 'INSTITUTION_ADMIN', 'COMPANY_ADMIN'], approved: () => null },
  { name: 'registry add institution', match: (r) => key(r) === 'POST /registry/institutions', roles: ['STUDENT'], approved: () => null },
]
const REGISTRY_CONTROLLERS = /Registry|Institution|Compan|Ministry|Student|Announcement|Contact|Contract|Vacanc|Training/
const REGISTRY = ALL.filter((r) => REGISTRY_CONTROLLERS.test(r.controller))
const OTHER_ROLES = ['STUDENT', 'TEACHER', 'CENTER_ADMIN', 'FINANCE_ADMIN', 'INSTITUTION_ADMIN', 'COMPANY_ADMIN', 'MINISTRY']

const contextFor = (r: Route, actor: { id: string; roles: string[] } | undefined) =>
  ({ getHandler: () => r.handler, getClass: () => r.cls, switchToHttp: () => ({ getRequest: () => ({ actor }) }) }) as unknown as ExecutionContext

describe('Registry access matrix (ТЗ 8, 9.4)', () => {
  it('finds the registry routes', () => {
    expect(REGISTRY.length).toBeGreaterThan(100)
  })

  it('no two routes of the API share a method and a path', () => {
    const seen = new Map<string, string>()
    const dupes = ALL.filter((r) => (seen.has(key(r)) ? true : (seen.set(key(r), r.controller), false))).map((r) => `${key(r)} (${r.controller} / ${seen.get(key(r))})`)
    expect(dupes).toEqual([])
  })

  it('every registry route fits exactly one rule — its roles, its «approved» and never public', () => {
    const problems: string[] = []
    for (const r of REGISTRY) {
      const rules = RULES.filter((rule) => rule.match(r))
      if (rules.length !== 1) { problems.push(`${key(r)}: ${rules.length} rules`); continue }
      const [rule] = rules
      if (r.public) problems.push(`${key(r)}: public`)
      if ([...r.roles].sort().join() !== [...rule.roles].sort().join()) problems.push(`${key(r)}: roles ${r.roles.join() || '—'}, expected ${rule.roles.join() || '—'} (${rule.name})`)
      if (r.approved !== rule.approved(r)) problems.push(`${key(r)}: approved ${r.approved}, expected ${rule.approved(r)}`)
    }
    expect(problems).toEqual([])
  })

  it('the role guard turns away every other role with 403 — the Super Admin passes, as everywhere', () => {
    const guard = new RolesGuard(new Reflector())
    const leaks: string[] = []
    for (const r of REGISTRY.filter((x) => x.roles.length)) {
      for (const role of OTHER_ROLES.filter((x) => !r.roles.includes(x))) {
        try { guard.canActivate(contextFor(r, { id: 'u', roles: [role] })); leaks.push(`${key(r)} lets ${role} in`) } catch (err) {
          if ((err as { getStatus?: () => number }).getStatus?.() !== 403) leaks.push(`${key(r)} → ${String(err)} for ${role}`)
        }
      }
      for (const role of r.roles) expect(guard.canActivate(contextFor(r, { id: 'u', roles: [role] }))).toBe(true)
      expect(guard.canActivate(contextFor(r, { id: 'u', roles: ['PLATFORM_ADMIN'] }))).toBe(true)
    }
    expect(leaks).toEqual([])
  })
})

describe.skipIf(!DB_AVAILABLE)('«Approved» on every route that needs it (ТЗ 8: an unapproved organization gets 403)', () => {
  const ctx = new TestContext()
  const guard = new ApprovedGuard(new Reflector(), ctx.prisma)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('only the representative of an approved (and not merged) organization of that kind gets through', async () => {
    const t = await ctx.makeTenant('acc-approved')
    const tenantId = t.tenantId
    const db = ctx.prisma.client
    await TenantContext.forTenant(tenantId, async () => {
      let n = 0
      const rep = async (link: object) => ({ id: (await db.user.create({ data: { tenantId, login: `acc-${++n}`, displayName: 'Rep', roles: ['INSTITUTION_ADMIN', 'COMPANY_ADMIN'], ...link } })).id, roles: ['INSTITUTION_ADMIN', 'COMPANY_ADMIN'] })
      const inst = (name: string, data: object) => db.institution.create({ data: { tenantId, type: 'TECHNIKUM', name, searchKey: registrySearchKey(`${name}-${tenantId}`), source: 'SELF', ...data } })
      const co = (stir: string, data: object) => db.company.create({ data: { tenantId, stir, name: stir, searchKey: registrySearchKey(`${stir}-${tenantId}`), ...data } })
      const approvedInst = await inst('Approved', { status: 'APPROVED', approvedAt: new Date() })
      const target = await inst('Target', { status: 'APPROVED', approvedAt: new Date() })
      const actors = {
        approvedInstitution: await rep({ institutionId: approvedInst.id }),
        pendingInstitution: await rep({ institutionId: (await inst('Pending', { status: 'PENDING' })).id }),
        rejectedInstitution: await rep({ institutionId: (await inst('Rejected', { status: 'REJECTED' })).id }),
        mergedInstitution: await rep({ institutionId: (await inst('Merged', { status: 'APPROVED', approvedAt: new Date(), mergedIntoId: target.id })).id }),
        approvedCompany: await rep({ companyId: (await co('401111111', { status: 'APPROVED', approvedAt: new Date() })).id }),
        pendingCompany: await rep({ companyId: (await co('402222222', { status: 'PENDING' })).id }),
        rejectedCompany: await rep({ companyId: (await co('403333333', { status: 'REJECTED' })).id }),
        nobody: await rep({}),
      }
      const passes: Record<string, keyof typeof actors> = { institution: 'approvedInstitution', company: 'approvedCompany' }
      const wrong: string[] = []
      const routes = REGISTRY.filter((r) => r.approved)
      expect(routes.length).toBeGreaterThan(40)
      for (const r of routes) {
        for (const [name, actor] of Object.entries(actors)) {
          const ok = await guard.canActivate(contextFor(r, actor)).then(() => true, (err: { code?: string }) => (err.code === 'not_approved' ? false : String(err)))
          if (ok !== (name === passes[r.approved!])) wrong.push(`${key(r)} for ${name}: ${ok}`)
        }
        await expect(guard.canActivate(contextFor(r, undefined))).rejects.toMatchObject({ code: 'not_approved' })
      }
      expect(wrong).toEqual([])
    })
  })
})
