import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BadRequestException, type ExecutionContext, ValidationPipe } from '@nestjs/common'
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { registrySearchKey } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { RolesGuard } from '../src/common/guards'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import { AttendanceService } from '../src/modules/attendance/attendance.service'
import type { AttendanceEvents } from '../src/modules/attendance/attendance.events'
import { ConsentDto } from '../src/modules/auth/auth.dto'
import { CenterStudentsService } from '../src/modules/center/center-students.service'
import { CenterService } from '../src/modules/center/center.service'
import { HomeworkService } from '../src/modules/classroom/homework.service'
import { JournalService } from '../src/modules/classroom/journal.service'
import { asCenter } from '../src/modules/center/admin-center.controller'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import { EnrollmentController } from '../src/modules/enrollment/enrollment.controller'
import { RefundDto } from '../src/modules/enrollment/refunds.dto'
import { CourseDiscountBody, CourseInput, CoursePatch } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import { RegistryService } from '../src/modules/registry/registry.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { StudentsService } from '../src/modules/students/students.service'
import { TenantsService } from '../src/modules/tenants/tenants.service'
import { TrainingService } from '../src/modules/training/training.service'
import { VacanciesService } from '../src/modules/vacancies/vacancies.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'
import { type Route, routesOf } from './support/routes'
import { logPath } from '../src/common/log-path'

/**
 * Access matrix of the API for the five accounts people sign in with: a center, a teacher, a student, a company and
 * the Super Admin.
 *
 *  1. Roles, on every route of the API (no database): each route that is not public fits exactly one rule below, and
 *     the real role guard lets in exactly the accounts the rule names — the others get 403. A new route that fits no
 *     rule fails here until it is classified on purpose.
 *  2. Somebody else's data (PostgreSQL): with the right role but another center's, teacher's, student's or company's id
 *     the answer is 403 or 404, and nothing changes. The owner gets through, so the refusal is about the owner, not a
 *     broken fixture.
 *
 * Institutions and the ministry are in registry-access.test.ts; here they only appear as «none of the five».
 */

type Who = 'center' | 'teacher' | 'student' | 'company'
const ACTORS: Record<Who | 'superAdmin', string[]> = {
  center: ['CENTER_ADMIN'],
  teacher: ['TEACHER'],
  student: ['STUDENT'],
  company: ['COMPANY_ADMIN'],
  superAdmin: ['PLATFORM_ADMIN'],
}
const WHO: Who[] = ['center', 'teacher', 'student', 'company']
const ALL = routesOf(AppModule)
const key = (r: Pick<Route, 'method' | 'path'>) => `${r.method} ${r.path}`

type Rule = { name: string; match: (r: Route) => boolean; allow: Who[] }
const path = (re: RegExp) => (r: Route) => re.test(r.path)
const exact = (...keys: string[]) => (r: Route) => keys.includes(key(r))
const SIGNED_IN: Who[] = ['center', 'teacher', 'student', 'company']

/** Order does not matter: a route must fit exactly one rule. */
const RULES: Rule[] = [
  // Any signed-in account: its own session, notifications, payments and attendance (the services scope them by actor).
  { name: 'own account', match: path(/^\/auth\/(me|consent|password)$/), allow: SIGNED_IN },
  { name: 'notifications', match: path(/^\/notifications(\/|$)/), allow: SIGNED_IN },
  { name: 'payment status', match: exact('GET /payments/:id'), allow: SIGNED_IN },
  { name: 'check-in', match: exact('POST /attendance/check-in', 'GET /attendance/centers/:code/options', 'POST /attendance/centers/:code/check-in', 'GET /student/attendance'), allow: SIGNED_IN },
  { name: 'registry reference', match: (r) => r.path.startsWith('/registry') && r.method === 'GET', allow: SIGNED_IN },
  { name: 'registry add direction', match: exact('POST /registry/directions'), allow: ['student', 'company'] },
  { name: 'registry add institution', match: exact('POST /registry/institutions'), allow: ['student'] },

  // Center workspace and the teacher's studio.
  { name: 'center workspace', match: path(/^\/center(\/|$)/), allow: ['center'] },
  { name: 'center courses and discounts', match: exact('GET /manage/center/courses', 'PUT /manage/courses/:id/discount'), allow: ['center'] },
  { name: 'course images', match: exact('GET /manage/uploads/status', 'POST /manage/uploads/course-image/upload-url'), allow: ['teacher', 'center'] },
  { name: 'teacher studio', match: (r) => r.path.startsWith('/manage/') && !exact('GET /manage/center/courses', 'PUT /manage/courses/:id/discount', 'GET /manage/uploads/status', 'POST /manage/uploads/course-image/upload-url')(r), allow: ['teacher'] },
  { name: 'lessons and attendance', match: path(/^\/teacher\/(sessions|groups)\//), allow: ['teacher', 'center'] },
  { name: 'center invitations', match: path(/^\/teacher\/center-invites(\/|$)/), allow: ['teacher'] },
  // Homework is given by the group's teacher (ТЗ 2026-11-18, 8.1); the center administrator does not.
  { name: 'homework (teacher)', match: path(/^\/teacher\/homework(\/|$)/), allow: ['teacher'] },

  // Student.
  { name: 'subscription and saved', match: path(/^\/student\/(subscription|saved)(\/|$)/), allow: ['student'] },
  { name: 'student registry', match: path(/^\/(students\/me|vacancies)(\/|$)/), allow: ['student'] },

  // Company.
  { name: 'company', match: path(/^\/(companies|announcements|graduates|contract-help)(\/|$)/), allow: ['company'] },

  // None of the five: institutions, the ministry and the Super Admin's own tools (finance included).
  { name: 'institution', match: path(/^\/(institutions|training-requests)(\/|$)/), allow: [] },
  { name: 'ministry', match: path(/^\/ministry(\/|$)/), allow: [] },
  { name: 'Super Admin', match: path(/^\/admin(\/|$)/), allow: [] },
]

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

describe('API access matrix: center, teacher, student, company, Super Admin', () => {
  it('finds the routes, the new center, teacher, company and student addresses among them', () => {
    expect(ALL.length).toBeGreaterThan(250)
    for (const k of ['PATCH /center/profile', 'GET /center/teachers', 'POST /teacher/center-invites/:id/accept', 'GET /admin/centers/:centerId/overview', 'PUT /manage/courses/:id/discount', 'GET /companies/me/vacancies/:id', 'POST /students/me/contact-requests/:id/accept'])
      expect(ALL.map(key)).toContain(k)
  })

  it('every route that is not public fits exactly one rule', () => {
    const problems = ALL.filter((r) => !r.public).map((r) => ({ r, n: RULES.filter((rule) => rule.match(r)).map((x) => x.name) })).filter((x) => x.n.length !== 1).map((x) => `${key(x.r)}: ${x.n.join(', ') || 'no rule'}`)
    expect(problems).toEqual([])
  })

  it('the role guard lets in exactly the accounts of the rule; the others get 403', () => {
    const wrong: string[] = []
    for (const r of ALL.filter((x) => !x.public)) {
      const rule = RULES.find((x) => x.match(r))!
      for (const who of WHO) {
        const ok = passes(r, ACTORS[who])
        if (ok !== rule.allow.includes(who)) wrong.push(`${key(r)} for ${who}: ${ok ? 'let in' : '403'}, expected ${rule.allow.includes(who) ? 'let in' : '403'} (${rule.name})`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('the Super Admin passes the role guard on every route', () => {
    expect(ALL.filter((r) => !r.public && !passes(r, ACTORS.superAdmin)).map(key)).toEqual([])
  })

  it('the Super Admin\'s twin of the center workspace is closed to the four others', () => {
    const twin = ALL.filter((r) => r.path.startsWith('/admin/centers/:centerId/'))
    expect(twin.length).toBe(ALL.filter((r) => r.path.startsWith('/center/')).length)
    for (const r of twin) for (const who of WHO) expect(passes(r, ACTORS[who]), `${key(r)} for ${who}`).toBe(false)
  })
})

/**
 * Areas of the new ТЗ that are only partly built: center students and their Excel import, invitations, attendance,
 * homework, price, parent consent, ZIP upload. A route that appears in one of them fails below, by name, until
 *  (1) it has a rule in RULES (enforced above for every route),
 *  (2) its id-like path param has a check with somebody else's id in the database section (FOREIGN_ID), or a reason
 *      it is not somebody's id (NOT_AN_ID),
 *  (3) for areas with security requirements, an entry saying where they are tested (SECURITY_DONE).
 */
type Area = { name: string; match: (r: Route) => boolean; security: string[] }
/** The Super Admin's twin of the center workspace falls in the same areas as the center's own route. */
const own = (p: string) => p.replace(/^\/admin\/centers\/:centerId(?=\/)/, '/center')
const any = (...res: RegExp[]) => (r: Route) => res.some((re) => re.test(own(r.path)))
/** Top-level keys of the zod schemas the route's parameters are validated with (@Body(new ZodValidationPipe(…))). */
const schemaKeys = (r: Route) => {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, r.cls, r.handler.name) ?? {}) as Record<string, { pipes?: { schema?: { shape?: object } }[] }>
  return Object.values(args).flatMap((a) => (a.pipes ?? []).flatMap((p) => Object.keys(p.schema?.shape ?? {})))
}
const PRICE = /price|discount|commission|tariff|fee/i
const AREAS: Area[] = [
  // Not /ministry/export: only the center, the teacher's studio and the teacher's side.
  { name: 'center students and Excel', match: any(/^\/(center|manage|teacher)\/(.*\/)?students(\/|$)/i, /excel|xlsx/i, /^\/(center|manage|teacher)(\/.*)?\/(import|export)(\/|$)/i), security: [] },
  {
    name: 'invitations', match: any(/invit/i),
    security: ['the token cannot be guessed (at least 128 random bits, stored hashed) and works once', 'the token is never in the URL path or query, so it reaches neither logs nor Referer', 'the token expires'],
  },
  { name: 'attendance', match: any(/attendance|\/sessions(\/|$)/i), security: [] },
  { name: 'homework', match: any(/homework|assignment/i), security: [] },
  // By path, and by the body: a course body carries the price and the discount.
  { name: 'price', match: (r) => any(PRICE)(r) || schemaKeys(r).some((k) => PRICE.test(k)), security: ['the body cannot carry its own price or commission', 'a discount below 5% is refused'] },
  { name: 'parent consent', match: any(/consent|parent/i), security: ['a center, teacher or company cannot give, change or forge a parent consent'] },
  {
    name: 'ZIP upload', match: any(/zip|archive|resource-file/i),
    security: [
      'limits against zip bombs: number of entries, total unpacked size, ratio', 'names with ../ or absolute paths', 'executable files',
      'expiry and rights of temporary links', 'no more than 1024 MB bypassing the browser check: the size is bound in the signature or checked by the server',
    ],
  },
]
const inAreas = ALL.filter((r) => AREAS.some((a) => a.match(r)))
const withSecurity = (r: Route) => AREAS.some((a) => a.security.length > 0 && a.match(r))
const routeKeys = new Set(ALL.map(key))
const hasParam = (r: Route) => r.path.includes(':')

/** Routes of the areas whose path param is somebody's id, attempted with somebody else's in the database section. */
const FOREIGN_ID = [
  'POST /teacher/center-invites/:id/accept', 'POST /teacher/center-invites/:id/decline',
  'PUT /manage/courses/:id/discount', 'PATCH /manage/courses/:id', 'PATCH /center/courses/:id',
  'POST /manage/groups/:id/sessions/generate', 'POST /center/groups/:id/sessions/generate',
  'GET /teacher/sessions/:id', 'POST /teacher/sessions/:id/open', 'POST /teacher/sessions/:id/close', 'POST /teacher/sessions/:id/qr',
  'POST /teacher/sessions/:id/records', 'PATCH /teacher/sessions/:id', 'PATCH /teacher/sessions/:id/time', 'GET /teacher/sessions/:id/stream',
  'POST /teacher/groups/:id/sessions',
  // ТЗ 2026-11-18: the center's table of students, the group journal, homework.
  'GET /center/students/:id', 'PATCH /center/students/:id', 'POST /center/students/:id/invite',
  'GET /teacher/groups/:id/attendance', 'PUT /teacher/groups/:id/attendance/marks',
  'GET /teacher/homework/:id', 'PATCH /teacher/homework/:id', 'DELETE /teacher/homework/:id', 'POST /teacher/homework/:id/extensions', 'POST /teacher/homework/:id/grades',
  'GET /students/me/homework/:id', 'POST /students/me/homework/:id/submissions',
]
/** Routes of the areas whose path param is not somebody's id, and why. */
const NOT_AN_ID: Record<string, string> = {
  'GET /attendance/centers/:code': 'the center\'s public standing QR code (a poster), not an id; an unknown code is 404',
  'GET /attendance/centers/:code/options': 'the center\'s public standing QR code; the options are the signed-in student\'s own groups there',
  'POST /attendance/centers/:code/check-in': 'the center\'s public standing QR code; the student checks in only themself',
  'POST /graduates/:cardId/invite': 'a card id is a keyed hash of (company, announcement, student), resolved only among the cards this company sees (GraduatesService.invite); any other value is 404',
  'POST /students/me/consents/:kind/give': 'kind is a consent kind (STUDENT_CONSENT_ACTION_KINDS); the student is always the signed-in one',
  'POST /students/me/consents/:kind/revoke': 'kind is a consent kind (STUDENT_CONSENT_ACTION_KINDS); the student is always the signed-in one',
}
/**
 * Public routes of the areas (no sign-in, so no role or ownership check applies). Each is public by design:
 * - GET /attendance/links/:sessionId: the check-in page shows which lesson a link is for (course, group, time);
 *   checking in needs the rotating token of an open lesson and a signed-in student.
 * - GET /attendance/centers/:code: the center's standing QR poster names the center; an unknown code is 404.
 */
const PUBLIC_IN_AREAS = ['GET /attendance/links/:sessionId', 'GET /attendance/centers/:code']
/**
 * Path params that look like a secret but are not one. The center's standing code is printed on a poster; it does land
 * in the API logs, since only the query is stripped there (known, reported). The catalog keys are a slug or an id.
 */
const TOKEN_LIKE_OK = ['GET /attendance/centers/:code', 'GET /attendance/centers/:code/options', 'POST /attendance/centers/:code/check-in', 'GET /public/courses/:key', 'GET /public/teachers/:key']
/** Super Admin only (RULES); reaches any center of its tenant by design, the tenant boundary is tested in the Super Admin test below. */
const ADMIN_PREFIX = '/admin/'

const COURSE_PRICE_DONE = 'here: «price: course bodies …» (strict: commission, fee, priceMinor refused) and «price: a discount below 5% is refused»; the price only with editPrices in test/course-center-scope.test.ts, the discount rules in test/discounts.test.ts, the calculator in test/price-calculator.test.ts'
const CENTER_INVITE_DONE = 'test/center-students.test.ts «invitation: …»: 256 random bits, only the SHA-256 stored, works once, expires in 7 days, one answer for wrong/used/expired; here «invitation token: …» (body only, never the path or the query)'
/** Route key → where the security list of its area is tested, or why it does not apply. */
const SECURITY_DONE: Record<string, string> = {
  'GET /teacher/center-invites': 'no token: an invitation is a row addressed to the signed-in teacher\'s account, listed only to them (teacher test below)',
  'POST /teacher/center-invites/:id/accept': 'no token: answered by id by the teacher it is addressed to; another teacher\'s id is refused (teacher test below)',
  'POST /teacher/center-invites/:id/decline': 'no token: as accept',
  // A student's invitation to a center's table (ТЗ 2026-11-18, 4.3).
  'POST /center/students/:id/invite': CENTER_INVITE_DONE,
  'POST /admin/centers/:centerId/students/:id/invite': CENTER_INVITE_DONE,
  'POST /students/me/center-invites/preview': CENTER_INVITE_DONE,
  'POST /students/me/center-invites/accept': CENTER_INVITE_DONE,
  'POST /graduates/:cardId/invite': 'no token: it creates a contact request the student answers in their own account; the card id is company-keyed (NOT_AN_ID)',
  'PUT /manage/courses/:id/discount': 'here: «price: the discount body …» (strict body) and «price: a discount below 5% is refused»; test/discounts.test.ts; the upper limit 100% − K — test/price-calculator.test.ts',
  // ILMORA's commission (ТЗ 18.11, 9.5): the Super Admin's route by design — the body carries the commission and nothing else.
  'PUT /admin/pricing': 'Super Admin only (RULES): the one body that carries a commission, strict (CommissionInput, 2–50%); audited (pricing.commission) — test/price-calculator.test.ts; centers and teachers get 403 here',
  'POST /manage/courses': COURSE_PRICE_DONE,
  'PATCH /manage/courses/:id': COURSE_PRICE_DONE,
  'POST /center/courses': COURSE_PRICE_DONE,
  'PATCH /center/courses/:id': COURSE_PRICE_DONE,
  'POST /admin/centers/:centerId/courses': COURSE_PRICE_DONE,
  'PATCH /admin/centers/:centerId/courses/:id': COURSE_PRICE_DONE,
  'POST /auth/consent': 'here: «parent consent: …» (the account\'s own offer acceptance; other fields refused)',
  'GET /students/me/consents': 'here: «parent consent: …» (read only, the student\'s own journal)',
  'POST /students/me/consents/:kind/give': 'here: «parent consent: …» (student only)',
  'POST /students/me/consents/:kind/revoke': 'here: «parent consent: …» (student only)',
  // Zip-bomb and ../-inside-the-archive checks belong to a future route that unpacks.
  'POST /manage/uploads/resource-file/upload-url': 'test/uploads-limits.test.ts: type and size signed in the link (enforcement by the S3 provider is not verified here); executables refused by content type only, bytes are not inspected; the archive is never unpacked',
}

/** The same options as the global pipe in src/main.ts (checked below). */
const bodyPipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transform: true, transformOptions: { enableImplicitConversion: false }, validationError: { target: false, value: false } })
const bodyOf = (cls: unknown, body: object) => bodyPipe.transform(body, { type: 'body', metatype: cls as never })

describe('New ТЗ areas: rules, somebody else\'s id, security', () => {
  it('finds the routes of the areas, and not unrelated ones', () => {
    const by = Object.fromEntries(AREAS.map((a) => [a.name, ALL.filter(a.match).map(key)]))
    expect([...by['center students and Excel']].sort()).toEqual([
      'GET /center/students', 'GET /center/students/roster', 'GET /center/students/export', 'POST /center/students/import/check', 'POST /center/students/import',
      'POST /center/students', 'GET /center/students/:id', 'PATCH /center/students/:id', 'POST /center/students/:id/invite',
      'GET /admin/centers/:centerId/students', 'GET /admin/centers/:centerId/students/roster', 'GET /admin/centers/:centerId/students/export',
      'POST /admin/centers/:centerId/students/import/check', 'POST /admin/centers/:centerId/students/import', 'POST /admin/centers/:centerId/students',
      'GET /admin/centers/:centerId/students/:id', 'PATCH /admin/centers/:centerId/students/:id', 'POST /admin/centers/:centerId/students/:id/invite',
    ].sort())
    expect(by.homework).toEqual(expect.arrayContaining(['POST /teacher/homework', 'GET /students/me/homework', 'POST /students/me/homework/:id/submissions']))
    expect(by.attendance).toEqual(expect.arrayContaining(['GET /teacher/groups/:id/attendance', 'PUT /teacher/groups/:id/attendance/marks']))
    expect([...by.invitations].sort()).toEqual([
      'GET /teacher/center-invites', 'POST /teacher/center-invites/:id/accept', 'POST /teacher/center-invites/:id/decline', 'POST /graduates/:cardId/invite',
      'POST /center/students/:id/invite', 'POST /admin/centers/:centerId/students/:id/invite', 'POST /students/me/center-invites/preview', 'POST /students/me/center-invites/accept',
    ].sort())
    expect(routeKeys.has('GET /ministry/export')).toBe(true)
    expect(by['center students and Excel']).not.toContain('GET /ministry/export')
    expect([...by.price].sort()).toEqual([
      'PATCH /admin/centers/:centerId/courses/:id', 'PATCH /center/courses/:id', 'PATCH /manage/courses/:id', 'POST /admin/centers/:centerId/courses', 'POST /center/courses', 'POST /manage/courses', 'PUT /admin/pricing', 'PUT /manage/courses/:id/discount',
    ])
    expect(by.attendance).toContain('POST /teacher/sessions/:id/open')
    expect(by['ZIP upload']).toEqual(['POST /manage/uploads/resource-file/upload-url'])
  })

  it('the public routes of the areas are exactly the known ones', () => {
    expect(inAreas.filter((r) => r.public).map(key)).toEqual(PUBLIC_IN_AREAS)
  })

  it('every route of the areas with a path param is attempted with somebody else\'s id, or says why the param is not an id', () => {
    const missing = inAreas.filter((r) => hasParam(r) && !PUBLIC_IN_AREAS.includes(key(r)) && !FOREIGN_ID.includes(key(r)) && !NOT_AN_ID[key(r)] && !r.path.startsWith(ADMIN_PREFIX)).map(key)
    expect(missing).toEqual([])
    const stale = [...FOREIGN_ID, ...Object.keys(NOT_AN_ID)].filter((k) => !inAreas.some((r) => key(r) === k && hasParam(r)))
    expect(stale).toEqual([])
    expect(FOREIGN_ID.filter((k) => NOT_AN_ID[k])).toEqual([])
  })

  it('every route of an area with security requirements says where they are tested', () => {
    expect(inAreas.filter((r) => withSecurity(r) && !SECURITY_DONE[key(r)]).map(key)).toEqual([])
    expect(Object.keys(SECURITY_DONE).filter((k) => !routeKeys.has(k) || !inAreas.some((r) => key(r) === k && withSecurity(r)))).toEqual([])
  })

  it('no route takes a token, secret, code or key in its path (they would reach logs and Referer)', () => {
    expect(ALL.filter((r) => /:[^/]*(token|secret|code|key)/i.test(r.path)).map(key).filter((k) => !TOKEN_LIKE_OK.includes(k))).toEqual([])
    expect(TOKEN_LIKE_OK.filter((k) => !routeKeys.has(k))).toEqual([])
  })

  it('invitation token: the student\'s routes take it in the body only — no path param, no query; the API never logs a body', () => {
    const studentSide = ALL.filter((r) => r.path.startsWith('/students/me/center-invites/'))
    expect(studentSide.map(key).sort()).toEqual(['POST /students/me/center-invites/accept', 'POST /students/me/center-invites/preview'])
    for (const r of studentSide) {
      expect(r.path, key(r)).not.toContain(':')
      expect(schemaKeys(r), key(r)).toContain('token')
      // RouteParamtypes.QUERY is 4: the handler has no @Query() argument at all.
      expect(Object.keys((Reflect.getMetadata(ROUTE_ARGS_METADATA, r.cls, r.handler.name) ?? {}) as object).some((k) => k.startsWith('4:')), key(r)).toBe(false)
    }
    // pino logs the path without the query and never the body; `req.body.token` is redacted besides.
    const core = readFileSync(join(__dirname, '../src/core.module.ts'), 'utf8')
    expect(core).toContain(`'req.body.token'`)
    // The path goes through logPath (src/common/log-path.ts, security review 19.11 №11): no query, QR code masked.
    expect(core).toMatch(/url: logPath\(req\.url\)/)
    expect(logPath('/students/me/center-invites/accept?token=SECRET')).toBe('/students/me/center-invites/accept')
  })

  // The minor's own mark of the parent's consent (questionnaire, PARENT_CONSENT kind) is self-attested by the student: known product gap, reported.
  it('parent consent: staff and companies cannot give, change or forge it — no write route lets a center, teacher or company through; the questionnaire (it carries the mark) is the student\'s', async () => {
    const writes = ALL.filter((r) => r.method !== 'GET' && /consent|parent/i.test(r.path) && key(r) !== 'POST /auth/consent')
    expect(writes.map(key)).toContain('POST /students/me/consents/:kind/give')
    const others: Who[] = ['center', 'teacher', 'company']
    expect(writes.flatMap((r) => others.filter((w) => r.public || passes(r, ACTORS[w])).map((w) => `${key(r)} for ${w}`))).toEqual([])
    const questionnaire = ALL.find((r) => key(r) === 'PUT /students/me/questionnaire')!
    expect(WHO.filter((w) => passes(questionnaire, ACTORS[w]))).toEqual(['student'])
    // POST /auth/consent is the account's own offer acceptance: the global pipe refuses any other field.
    expect(readFileSync(join(__dirname, '../src/main.ts'), 'utf8')).toMatch(/whitelist: true,\s*forbidNonWhitelisted: true/)
    const ok = { acceptOffer: true, consentPersonalData: true }
    await expect(bodyOf(ConsentDto, ok)).resolves.toBeTruthy()
    for (const extra of [{ parentConsent: true }, { kind: 'PARENT_CONSENT' }, { guardianConsent: true }])
      await expect(bodyOf(ConsentDto, { ...ok, ...extra }), JSON.stringify(extra)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('price: the discount body carries only the discount — no price, commission or fee of its own', () => {
    const discount = { percent: 10, startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z' }
    expect(CourseDiscountBody.safeParse({ discount }).success).toBe(true)
    for (const extra of [{ price: 1 }, { commission: 0 }, { fee: 0 }]) {
      expect(CourseDiscountBody.safeParse({ discount, ...extra }).success, JSON.stringify(extra)).toBe(false)
      expect(CourseDiscountBody.safeParse({ discount: { ...discount, ...extra } }).success, JSON.stringify(extra)).toBe(false)
    }
  })

  it('price: course bodies carry no commission, fee or amount of their own (strict)', () => {
    expect(CoursePatch.safeParse({}).success).toBe(true)
    for (const k of ['commission', 'fee', 'priceMinor'])
      for (const [name, schema] of [['CourseInput', CourseInput], ['CoursePatch', CoursePatch]] as const) {
        const issues = schema.safeParse({ [k]: 1 }).error?.issues ?? []
        expect(issues.some((i) => i.code === 'unrecognized_keys' && i.keys.includes(k)), `${name} ${k}`).toBe(true)
      }
  })

  // Closed (ТЗ 18.11, 9.1; Шерзод, 20.11): DiscountInput and checkDiscount take 5% and more; the upper limit 100% − K is the service's.
  it('price: a discount below 5% is refused (ТЗ)', () => {
    const window = { startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z' }
    expect(CourseDiscountBody.safeParse({ discount: { percent: 4, ...window } }).success).toBe(false)
    expect(CourseDiscountBody.safeParse({ discount: { percent: 5, ...window } }).success).toBe(true)
    for (const schema of [CourseInput, CoursePatch]) expect(schema.safeParse({ discount: { percent: 4, ...window } }).error?.issues.some((i) => i.path.includes('percent'))).toBe(true)
  })

  it('price: the student\'s cart and checkout carry no amount of their own (the server prices them)', async () => {
    // The body DTO is the last parameter of the handler; a missing one fails here, not as a silent pass.
    const dto = (m: string) => {
      const cls = (Reflect.getMetadata('design:paramtypes', EnrollmentController.prototype, m) as unknown[] | undefined)?.at(-1)
      if (typeof cls !== 'function' || cls === Object || cls === String) throw new Error(`EnrollmentController.${m}: no body DTO in the metadata`)
      return cls
    }
    expect(dto('quoteRefund')).toBe(RefundDto)
    expect(dto('requestRefund')).toBe(RefundDto)
    const valid: Record<string, object> = {
      checkout: { provider: 'PAYME' }, renew: { provider: 'PAYME' }, draft: { packageId: null, groupIds: [], meyosGrant: false },
      quoteRefund: { reason: 'OTHER' }, requestRefund: { reason: 'OTHER' },
    }
    for (const [m, body] of Object.entries(valid)) {
      await expect(bodyOf(dto(m), body), m).resolves.toBeTruthy()
      for (const extra of [{ amount: 1 }, { price: 1 }, { commission: 0 }])
        await expect(bodyOf(dto(m), { ...body, ...extra }), `${m} ${JSON.stringify(extra)}`).rejects.toBeInstanceOf(BadRequestException)
    }
  })
})

/** 403 or 404 is a refusal; anything else (a result, 400, 409, 500) is reported as it is. */
const statusOf = (p: Promise<unknown>) => p.then(() => 'ok' as const, (err: { getStatus?: () => number }) => err?.getStatus?.() ?? String(err))
const REFUSED = [403, 404]

describe.skipIf(!DB_AVAILABLE)('Somebody else\'s data: 403 or 404, and nothing changes', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const centers = () => new CenterService(ctx.prisma, ctx.audit, {} as unknown as AttendanceService, notificationsStub)
  const manage = () =>
    new ManageService(
      ctx.prisma,
      ctx.audit,
      { generateForGroup: async () => 0, todayLocal: () => '2026-11-19' } as unknown as SessionsService,
      { get: async () => ({ permissions: { teacher: { editCourses: true, editPrices: true, publishDirectly: true, manageGroups: true, editSchedules: true } } }) } as unknown as SiteService,
      notificationsStub,
      ctx.env,
    )
  class MemoryDocs extends PrivateDocsService {
    constructor() { super(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })) }
    override async downloadUrl(k: string) { return `https://s3.test/ilmora-docs/${k}?X-Amz-Expires=300` }
  }
  const docs = new MemoryDocs()
  const contacts = () => new ContactsService(ctx.prisma, ctx.audit, notificationsStub, docs)
  const vacancies = () => new VacanciesService(ctx.prisma, ctx.audit, notificationsStub, contacts(), new StudentsService(ctx.prisma, ctx.audit, notificationsStub, new RegistryService(ctx.prisma, ctx.audit)), docs)
  const training = () => new TrainingService(ctx.prisma, ctx.audit, notificationsStub)

  /**
   * One tenant with two of everything: centers A and B (approved), a teacher of each with a course and a group,
   * a free teacher with B's invitation, companies A and B (approved) with a vacancy and a training request each,
   * and students A and B — B applied to company B's vacancy and has company B's contact request.
   */
  async function world() {
    const t = await ctx.makeTenant('acm')
    const tenantId = t.tenantId
    const s = randomUUID().slice(0, 8)
    const db = ctx.prisma.client
    return TenantContext.forTenant(tenantId, async () => {
      await db.center.update({ where: { id: t.center.id }, data: { status: 'ACTIVE', approvedAt: new Date() } })
      const centerB = t.center
      const centerA = await db.center.create({ data: { tenantId, slug: `a-${s}`, name: 'Markaz A', district: {}, description: {}, status: 'ACTIVE', approvedAt: new Date() } })
      const userCenterA = await db.user.create({ data: { tenantId, login: `ca-${s}`, displayName: 'Center A', roles: ['CENTER_ADMIN'], centerId: centerA.id } })
      const center: RequestActor = { id: userCenterA.id, roles: ['CENTER_ADMIN'], centerId: centerA.id }
      const userCenterB = await db.user.create({ data: { tenantId, login: `cb-${s}`, displayName: 'Center B', roles: ['CENTER_ADMIN'], centerId: centerB.id } })
      const centerOwner: RequestActor = { id: userCenterB.id, roles: ['CENTER_ADMIN'], centerId: centerB.id }

      // Teacher A works at center A with a course and group of their own; t.teacher (center B) owns t.course / t.group.
      const userTeacherA = await db.user.create({ data: { tenantId, login: `ta-${s}`, displayName: 'Teacher A', roles: ['TEACHER'], centerId: centerA.id } })
      const teacherA = await db.teacherProfile.create({ data: { tenantId, slug: `ta-${s}`, name: 'Teacher A', title: {}, bio: {}, tagline: {}, centerId: centerA.id, userId: userTeacherA.id } })
      const teacher: RequestActor = { id: userTeacherA.id, roles: ['TEACHER'], centerId: centerA.id, teacherProfileId: teacherA.id }
      const teacherOwner: RequestActor = { id: t.teacherUser.id, roles: ['TEACHER'], centerId: centerB.id, teacherProfileId: t.teacher.id }
      // A free teacher invited by center B.
      const userFree = await db.user.create({ data: { tenantId, login: `tf-${s}`, displayName: 'Free teacher', roles: ['TEACHER'] } })
      const invite = await db.teacherInvite.create({ data: { tenantId, centerId: centerB.id, userId: userFree.id, invitedById: userCenterB.id } })
      const invited: RequestActor = { id: userFree.id, roles: ['TEACHER'], centerId: null }

      // Companies and students.
      const region = await db.region.create({ data: { tenantId, code: `r-${s}`, name: { uz: 'Viloyat', ru: 'Область', en: 'Region' } } })
      const industry = await db.industry.create({ data: { tenantId, slug: `i-${s}`, name: { uz: 'IT', ru: 'IT', en: 'IT' } } })
      const direction = await db.direction.create({ data: { tenantId, name: `Dasturlaş ${s}`, searchKey: registrySearchKey(`Dasturlaş ${s}`), industryId: industry.id } })
      const stir = () => String(Math.floor(100_000_000 + Math.random() * 899_999_999))
      const company = async (name: string) => {
        const row = await db.company.create({ data: { tenantId, stir: stir(), name, searchKey: registrySearchKey(`${name} ${s}`), status: 'APPROVED', approvedAt: new Date(), regionId: region.id } })
        const u = await db.user.create({ data: { tenantId, login: `co-${name}-${s}`, displayName: name, roles: ['COMPANY_ADMIN'], companyId: row.id } })
        const vacancy = await db.vacancy.create({ data: { tenantId, companyId: row.id, kind: 'PRACTICE', title: `Amaliyot ${name}`, regionId: region.id, format: 'ONSITE', seats: 2 } })
        const request = await db.trainingRequest.create({ data: { tenantId, companyId: row.id, directionId: direction.id, count: 3, byYear: new Date().getUTCFullYear() + 1 } })
        return { row, vacancy, request, actor: { id: u.id, roles: ['COMPANY_ADMIN'], companyId: row.id } as RequestActor }
      }
      const coA = await company('A')
      const coB = await company('B')
      const studentA: RequestActor = { id: (await ctx.makeStudent(tenantId)).id, roles: ['STUDENT'] }
      const studentB: RequestActor = { id: (await ctx.makeStudent(tenantId)).id, roles: ['STUDENT'] }
      const application = await db.vacancyApplication.create({ data: { tenantId, vacancyId: coB.vacancy.id, userId: studentB.id } })
      const contactRequest = await db.contactRequest.create({ data: { tenantId, companyId: coB.row.id, userId: studentB.id, source: 'STUDENTS' } })

      return { ...t, s, centerA, centerB, centerActor: center, centerOwner, teacherActor: teacher, teacherOwner, invite, invited, coA, coB, studentA, studentB, application, contactRequest }
    })
  }
  type World = Awaited<ReturnType<typeof world>>
  const inTenant = <T>(w: World, fn: () => Promise<T>) => TenantContext.forTenant(w.tenantId, fn)

  /** Names of every attempt run here, so FOREIGN_ID cannot claim a check that does not exist (the last test). */
  const attempted = new Set<string>()
  /** Runs every attempt and lists the ones that were not refused with 403 or 404. */
  async function refusedAll(w: World, attempts: Record<string, () => Promise<unknown>>) {
    const leaks: string[] = []
    for (const [name, attempt] of Object.entries(attempts)) {
      attempted.add(name)
      const status = await inTenant(w, () => statusOf(attempt()))
      if (!REFUSED.includes(status as number)) leaks.push(`${name}: ${status}`)
    }
    expect(leaks).toEqual([])
  }

  it('center: another center\'s courses, groups and teachers — refused, and they stay as they were', async () => {
    const w = await world()
    const { centerActor: a, tenantId: tid } = w
    const L = { uz: 'X', ru: 'X', en: 'X' }
    await refusedAll(w, {
      'PATCH /center/courses/:id': () => manage().updateCourse(tid, a, w.course.id, { title: L } as never),
      'DELETE /center/courses/:id': () => manage().deleteCourse(tid, a, w.course.id),
      'POST /center/courses/:courseId/groups': () => manage().createGroup(tid, a, w.course.id, { name: 'X', days: [1], start: '10:00', end: '11:00', capacity: 5 } as never),
      'GET /center/groups/:id': () => manage().groupDetail(tid, a, w.group.id),
      'PATCH /center/groups/:id': () => manage().updateGroup(tid, a, w.group.id, { capacity: 50 }),
      'DELETE /center/groups/:id': () => manage().deleteGroup(tid, a, w.group.id),
      'POST /center/groups/:id/sessions/generate': () => manage().generateGroupSessions(tid, a, w.group.id, 7),
      'PUT /manage/courses/:id/discount': () => manage().setCourseDiscount(tid, a, w.course.id, null),
      'PATCH /center/teachers/:id': () => centers().updateTeacher(tid, a, w.teacher.id, { name: 'X' }),
      'DELETE /center/teachers/:id': () => centers().removeTeacher(tid, a, w.teacher.id),
      // A center admin without a center reaches no center at all.
      'GET /center/overview without a center': () => centers().overview(tid, { ...a, centerId: null }),
      'GET /manage/center/courses without a center': () => manage().listCenterCourses(tid, { ...a, centerId: null }),
    })
    // Lists show only center A.
    const [courses, groups, teachers] = await inTenant(w, () => Promise.all([manage().listCenterCourses(tid, a), manage().myGroups(tid, a), centers().teachers(tid, a)]))
    expect(courses.center.id).toBe(w.centerA.id)
    expect(courses.courses.map((c) => c.id)).not.toContain(w.course.id)
    expect(groups.map((g) => g.id)).not.toContain(w.group.id)
    expect(teachers.map((x) => x.id)).not.toContain(w.teacher.id)
    // Nothing of center B changed.
    const db = ctx.prisma.client
    const [course, group, profile] = await inTenant(w, () => Promise.all([
      db.course.findFirstOrThrow({ where: { id: w.course.id } }), db.group.findFirstOrThrow({ where: { id: w.group.id } }), db.teacherProfile.findFirstOrThrow({ where: { id: w.teacher.id } }),
    ]))
    expect(course).toMatchObject({ deletedAt: null, title: w.course.title })
    expect(group).toMatchObject({ deletedAt: null, capacity: w.group.capacity })
    expect(profile).toMatchObject({ centerId: w.centerB.id, name: w.teacher.name })
    // Center B's own administrator gets through (the refusal is about ownership).
    await expect(inTenant(w, () => manage().groupDetail(tid, w.centerOwner, w.group.id))).resolves.toMatchObject({ group: { id: w.group.id } })
  })

  it('teacher: another teacher\'s course and group, another teacher\'s invitation — refused', async () => {
    const w = await world()
    const { teacherActor: a, tenantId: tid } = w
    await refusedAll(w, {
      'PATCH /manage/courses/:id': () => manage().updateCourse(tid, a, w.course.id, { price: 1 } as never),
      'DELETE /manage/courses/:id': () => manage().deleteCourse(tid, a, w.course.id),
      'POST /manage/courses/:courseId/groups': () => manage().createGroup(tid, a, w.course.id, { name: 'X', days: [1], start: '10:00', end: '11:00', capacity: 5 } as never),
      'GET /manage/groups/:id': () => manage().groupDetail(tid, a, w.group.id),
      'PATCH /manage/groups/:id': () => manage().updateGroup(tid, a, w.group.id, { capacity: 50 }),
      'DELETE /manage/groups/:id': () => manage().deleteGroup(tid, a, w.group.id),
      'POST /manage/groups/:id/sessions/generate': () => manage().generateGroupSessions(tid, a, w.group.id, 7),
      'PUT /manage/courses/:id/discount (teachers never)': () => manage().setCourseDiscount(tid, w.teacherOwner, w.course.id, null),
      'POST /teacher/center-invites/:id/accept': () => centers().respondInvite(tid, a, w.invite.id, true),
      'POST /teacher/center-invites/:id/decline': () => centers().respondInvite(tid, a, w.invite.id, false),
    })
    expect((await inTenant(w, () => manage().myGroups(tid, a))).map((g) => g.id)).not.toContain(w.group.id)
    expect(await inTenant(w, () => centers().myInvites(tid, a))).toEqual([])
    const db = ctx.prisma.client
    const [group, invite] = await inTenant(w, () => Promise.all([db.group.findFirstOrThrow({ where: { id: w.group.id } }), db.teacherInvite.findFirstOrThrow({ where: { id: w.invite.id } })]))
    expect(group).toMatchObject({ deletedAt: null, capacity: w.group.capacity })
    expect(invite.status).toBe('PENDING')
    // The owner and the invited teacher get through.
    await expect(inTenant(w, () => manage().groupDetail(tid, w.teacherOwner, w.group.id))).resolves.toMatchObject({ group: { id: w.group.id } })
    expect((await inTenant(w, () => centers().myInvites(tid, w.invited))).map((i) => i.id)).toEqual([w.invite.id])
  })

  it('student: another student\'s contact request and application — refused', async () => {
    const w = await world()
    const { studentA: a, tenantId: tid } = w
    await refusedAll(w, {
      'POST /students/me/contact-requests/:id/accept': () => contacts().decide(tid, a, w.contactRequest.id, true),
      'POST /students/me/contact-requests/:id/decline': () => contacts().decide(tid, a, w.contactRequest.id, false),
      'POST /students/me/contact-requests/:id/revoke': () => contacts().revoke(a, w.contactRequest.id),
      'DELETE /students/me/applications/:id': () => vacancies().withdraw(a, w.application.id),
    })
    const [mine, apps] = await inTenant(w, () => Promise.all([contacts().studentList(a), vacancies().myApplications(a)]))
    expect(JSON.stringify(mine)).not.toContain(w.contactRequest.id)
    expect(JSON.stringify(apps)).not.toContain(w.application.id)
    const db = ctx.prisma.client
    const [request, application] = await inTenant(w, () => Promise.all([db.contactRequest.findFirstOrThrow({ where: { id: w.contactRequest.id } }), db.vacancyApplication.findFirst({ where: { id: w.application.id } })]))
    expect(request.status).toBe('PENDING')
    expect(application).not.toBeNull()
    // Student B sees both.
    expect(JSON.stringify(await inTenant(w, () => contacts().studentList(w.studentB)))).toContain(w.contactRequest.id)
    expect(JSON.stringify(await inTenant(w, () => vacancies().myApplications(w.studentB)))).toContain(w.application.id)
  })

  it('company: another company\'s vacancy, applications, training request and contacts — refused', async () => {
    const w = await world()
    const { tenantId: tid } = w
    const a = w.coA.actor
    await refusedAll(w, {
      'GET /companies/me/vacancies/:id': () => vacancies().companyGet(a, w.coB.vacancy.id),
      'PATCH /companies/me/vacancies/:id': () => vacancies().update(a, w.coB.vacancy.id, { seats: 9 } as never),
      'POST /companies/me/vacancies/:id/close': () => vacancies().close(a, w.coB.vacancy.id),
      'GET /companies/me/vacancies/:id/applications': () => vacancies().applications(tid, a, w.coB.vacancy.id),
      'GET /companies/me/vacancy-applications/:id': () => vacancies().application(tid, a, w.application.id),
      'POST /companies/me/vacancy-applications/:id/status': () => vacancies().setStatus(tid, a, w.application.id, 'REJECTED' as never),
      'GET /companies/me/training-requests/:id': () => training().getOwn(a, w.coB.request.id),
      'PATCH /companies/me/training-requests/:id': () => training().update(a, w.coB.request.id, { count: 9 } as never),
      'POST /companies/me/training-requests/:id/close': () => training().close(a, w.coB.request.id),
      'GET /companies/me/contacts/:id': () => contacts().companyContact(a, w.contactRequest.id),
    })
    const [list, requests] = await inTenant(w, () => Promise.all([vacancies().companyList(a), training().listOwn(a)]))
    expect(JSON.stringify(list)).not.toContain(w.coB.vacancy.id)
    expect(JSON.stringify(requests)).not.toContain(w.coB.request.id)
    const db = ctx.prisma.client
    const [vacancy, request, application] = await inTenant(w, () => Promise.all([
      db.vacancy.findFirstOrThrow({ where: { id: w.coB.vacancy.id } }), db.trainingRequest.findFirstOrThrow({ where: { id: w.coB.request.id } }), db.vacancyApplication.findFirstOrThrow({ where: { id: w.application.id } }),
    ]))
    expect(vacancy).toMatchObject({ status: 'OPEN', seats: 2 })
    expect(request).toMatchObject({ status: 'OPEN', count: 3 })
    expect(application.status).toBe('NEW')
    // Company B gets its own.
    await expect(inTenant(w, () => vacancies().companyGet(w.coB.actor, w.coB.vacancy.id))).resolves.toMatchObject({ id: w.coB.vacancy.id })
    await expect(inTenant(w, () => training().getOwn(w.coB.actor, w.coB.request.id))).resolves.toMatchObject({ id: w.coB.request.id })
  })

  it('Super Admin: any center of the tenant through the twin routes, but not a center of another tenant', async () => {
    const w = await world()
    const other = await ctx.makeTenant('acm-other')
    const owner: RequestActor = { id: 'u-owner', roles: ['PLATFORM_ADMIN'], centerId: null }
    // Centers A and B, their groups.
    await expect(inTenant(w, () => centers().overview(w.tenantId, asCenter(owner, w.centerB.id)))).resolves.toBeTruthy()
    await expect(inTenant(w, () => centers().overview(w.tenantId, asCenter(owner, w.centerA.id)))).resolves.toBeTruthy()
    await expect(inTenant(w, () => manage().groupDetail(w.tenantId, asCenter(owner, w.centerB.id), w.group.id))).resolves.toMatchObject({ group: { id: w.group.id } })
    // Another tenant's center, group and course do not exist here.
    await refusedAll(w, {
      'GET /admin/centers/:centerId/overview (other tenant)': () => centers().overview(w.tenantId, asCenter(owner, other.center.id)),
      'GET /admin/centers/:centerId/teachers (other tenant)': () => centers().teachers(w.tenantId, asCenter(owner, other.center.id)),
      'GET /admin/centers/:centerId/groups/:id (other tenant)': () => manage().groupDetail(w.tenantId, asCenter(owner, other.center.id), other.group.id),
      'PATCH /admin/centers/:centerId/courses/:id (other tenant)': () => manage().updateCourse(w.tenantId, asCenter(owner, other.center.id), other.course.id, { price: 1 } as never),
      'GET /admin/centers/:centerId/overview (no such center)': () => centers().overview(w.tenantId, asCenter(owner, 'no-such-center')),
    })
  })

  it('attendance: another teacher\'s and another center\'s lesson — refused, and it stays as it was', async () => {
    const w = await world()
    const events = { publish: async () => undefined } as unknown as AttendanceEvents
    const attendance = new AttendanceService(ctx.prisma, ctx.audit, events, new TenantsService(ctx.prisma, ctx.env), ctx.subscriptions, notificationsStub, ctx.env)
    const db = ctx.prisma.client
    // A lesson of center B's group, taught by center B's teacher.
    const session = await inTenant(w, () => db.lessonSession.create({
      data: { tenantId: w.tenantId, groupId: w.group.id, courseId: w.group.courseId, date: new Date('2031-03-03T00:00:00.000Z'), startsAt: new Date('2031-03-03T05:00:00.000Z'), endsAt: new Date('2031-03-03T06:00:00.000Z') },
    }))
    const before = await inTenant(w, () => db.lessonSession.count({ where: { groupId: w.group.id } }))
    // Another teacher of the same center B: the center is not enough, the course must be theirs.
    const sameCenter = await inTenant(w, async () => {
      const u = await db.user.create({ data: { tenantId: w.tenantId, login: `tb2-${w.s}`, displayName: 'Teacher B2', roles: ['TEACHER'], centerId: w.centerB.id } })
      const p = await db.teacherProfile.create({ data: { tenantId: w.tenantId, slug: `tb2-${w.s}`, name: 'Teacher B2', title: {}, bio: {}, tagline: {}, centerId: w.centerB.id, userId: u.id } })
      return { id: u.id, roles: ['TEACHER'], centerId: w.centerB.id, teacherProfileId: p.id } as RequestActor
    })
    const attempts = (a: RequestActor, suffix: string) => ({
      [`GET /teacher/sessions/:id${suffix}`]: () => attendance.sessionDetail(session.id, a),
      // The SSE stream checks the same ownership before it subscribes.
      [`GET /teacher/sessions/:id/stream${suffix}`]: () => attendance.sessionForTeacher(session.id, a),
      [`POST /teacher/sessions/:id/open${suffix}`]: () => attendance.open(session.id, a),
      [`POST /teacher/sessions/:id/close${suffix}`]: () => attendance.close(session.id, a),
      [`POST /teacher/sessions/:id/qr${suffix}`]: () => attendance.qr(session.id, a),
      [`POST /teacher/sessions/:id/records${suffix}`]: () => attendance.correct(session.id, a, { studentId: w.studentA.id, status: 'PRESENT', reason: 'x' }),
      [`PATCH /teacher/sessions/:id${suffix}`]: () => attendance.setStatus(session.id, 'cancelled', a, 'x'),
      [`PATCH /teacher/sessions/:id/time${suffix}`]: () => attendance.rescheduleSession(session.id, a, { start: '09:00', end: '10:00' }),
      [`POST /teacher/groups/:id/sessions${suffix}`]: () => attendance.addExtraSession(w.group.id, a, { date: '2031-03-10', start: '09:00', end: '10:00' }),
    })
    await refusedAll(w, { ...attempts(w.teacherActor, ''), ...attempts(w.centerActor, ' (center)'), ...attempts(sameCenter, ' (same center)') })
    const [after, count, records] = await inTenant(w, () => Promise.all([
      db.lessonSession.findFirstOrThrow({ where: { id: session.id } }), db.lessonSession.count({ where: { groupId: w.group.id } }), db.attendanceRecord.count({ where: { sessionId: session.id } }),
    ]))
    expect(after).toMatchObject({ attendanceOpen: false, attendanceTokenHash: null, status: 'SCHEDULED', startsAt: session.startsAt, endsAt: session.endsAt, tokenVersion: session.tokenVersion })
    expect(count).toBe(before)
    expect(records).toBe(0)
    // The teacher of the course and center B's administrator get through.
    await expect(inTenant(w, () => attendance.sessionDetail(session.id, w.teacherOwner))).resolves.toMatchObject({ session: { id: session.id } })
    await expect(inTenant(w, () => attendance.sessionDetail(session.id, w.centerOwner))).resolves.toMatchObject({ session: { id: session.id } })
  })

  it('center students, journal and homework (ТЗ 2026-11-18): another center\'s student, another teacher\'s group and homework — refused, and they stay as they were', async () => {
    const w = await world()
    const db = ctx.prisma.client
    const table = new CenterStudentsService(ctx.prisma, ctx.audit, new TenantsService(ctx.prisma, ctx.env), ctx.env)
    const journal = new JournalService(ctx.prisma, ctx.audit)
    const homework = new HomeworkService(ctx.prisma, ctx.audit)
    // Center B's own student in center B's group, a past lesson of that group, a homework of center B's teacher.
    const { cs, session, hw, studentOfB } = await inTenant(w, async () => {
      const studentOfB = await ctx.makeStudent(w.tenantId)
      const cs = await db.centerStudent.create({ data: { tenantId: w.tenantId, centerId: w.centerB.id, fullName: 'Talaba B', phoneE164: `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, birthDate: new Date('2000-01-01'), userId: studentOfB.id, inviteAcceptedAt: new Date() } })
      await db.centerStudentGroup.create({ data: { tenantId: w.tenantId, centerStudentId: cs.id, groupId: w.group.id } })
      const session = await db.lessonSession.create({ data: { tenantId: w.tenantId, groupId: w.group.id, courseId: w.group.courseId, date: new Date('2026-01-05T00:00:00.000Z'), startsAt: new Date('2026-01-05T13:00:00.000Z'), endsAt: new Date('2026-01-05T14:00:00.000Z'), status: 'COMPLETED' } })
      const hw = await db.homework.create({ data: { tenantId: w.tenantId, groupId: w.group.id, title: 'Vazifa', description: 'Matn', submitModes: ['TEXT'], dueAt: new Date(Date.now() + 86_400_000) } })
      return { cs, session, hw, studentOfB }
    })
    const mark = { sessionId: session.id, centerStudentId: cs.id, status: 'PRESENT' as const }
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString()
    await refusedAll(w, {
      // Center A's administrator and center B's student.
      'GET /center/students/:id': () => table.detail(w.tenantId, w.centerActor, cs.id),
      'PATCH /center/students/:id': () => table.update(w.tenantId, w.centerActor, cs.id, { fullName: 'X', status: 'LEFT' }),
      'POST /center/students/:id/invite': () => table.invite(w.tenantId, w.centerActor, cs.id),
      // Teacher A and center A: center B's group journal.
      'GET /teacher/groups/:id/attendance': () => journal.journal(w.group.id, w.teacherActor),
      'GET /teacher/groups/:id/attendance (center)': () => journal.journal(w.group.id, w.centerActor),
      'PUT /teacher/groups/:id/attendance/marks': () => journal.setMark(w.group.id, w.teacherActor, mark),
      'PUT /teacher/groups/:id/attendance/marks (center)': () => journal.setMark(w.group.id, w.centerActor, mark),
      // Teacher A: center B teacher's homework.
      'GET /teacher/homework/:id': () => homework.detail(w.teacherActor, hw.id),
      'PATCH /teacher/homework/:id': () => homework.update(w.teacherActor, hw.id, { title: 'X' }),
      'DELETE /teacher/homework/:id': () => homework.remove(w.teacherActor, hw.id),
      'POST /teacher/homework/:id/extensions': () => homework.extend(w.teacherActor, hw.id, { studentId: studentOfB.id, dueAt: future }),
      'POST /teacher/homework/:id/grades': () => homework.grade(w.teacherActor, hw.id, { studentId: studentOfB.id, grade: 5 }),
      'GET /teacher/homework list of another group': () => homework.list(w.teacherActor, w.group.id),
      // Student A is not in center B's group.
      'GET /students/me/homework/:id': () => homework.myDetail(w.studentA, hw.id),
      'POST /students/me/homework/:id/submissions': () => homework.submit(w.studentA, hw.id, { text: 'x' }),
      // Student A cannot leave center B on student B's behalf.
      'POST /students/me/centers/:id/leave (another student)': () => table.leave(w.tenantId, w.studentA, cs.id),
    })
    const [after, marks, hwAfter, ext, subs] = await inTenant(w, () => Promise.all([
      db.centerStudent.findFirstOrThrow({ where: { id: cs.id } }), db.centerAttendanceMark.count({ where: { centerStudentId: cs.id } }), db.homework.findFirst({ where: { id: hw.id } }),
      db.homeworkExtension.count({ where: { homeworkId: hw.id } }), db.homeworkSubmission.count({ where: { homeworkId: hw.id } }),
    ]))
    expect(after).toMatchObject({ fullName: 'Talaba B', status: 'STUDYING', inviteSends: 0 })
    expect([marks, ext, subs]).toEqual([0, 0, 0])
    expect(hwAfter).toMatchObject({ title: 'Vazifa' })
    // Center A's table has no trace of center B's student.
    expect(JSON.stringify(await inTenant(w, () => table.roster(w.tenantId, w.centerActor, {})))).not.toContain(cs.id)
    // The owners get through: center B, its teacher, the student of the group.
    await expect(inTenant(w, () => table.detail(w.tenantId, w.centerOwner, cs.id))).resolves.toMatchObject({ student: { id: cs.id } })
    await expect(inTenant(w, () => journal.journal(w.group.id, w.teacherOwner))).resolves.toMatchObject({ group: { id: w.group.id } })
    await expect(inTenant(w, () => homework.detail(w.teacherOwner, hw.id))).resolves.toMatchObject({ homework: { id: hw.id } })
    await expect(inTenant(w, () => homework.myDetail({ id: studentOfB.id, roles: ['STUDENT'] }, hw.id))).resolves.toMatchObject({ homework: { id: hw.id } })
  })

  // Keep it the last test of this section: it relies on the earlier tests of this file (vitest runs them in order) and
  // reads the names every refusedAll above ran. If they did not run (filtered with -t, or skipped), it fails loudly.
  it('every FOREIGN_ID route was attempted with somebody else\'s id above', () => {
    expect(attempted.size, 'no refusedAll ran before this test').toBeGreaterThan(0)
    expect(FOREIGN_ID.filter((k) => ![...attempted].some((name) => name === k || name.startsWith(`${k} `)))).toEqual([])
  })
})
