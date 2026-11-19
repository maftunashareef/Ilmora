import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { registrySearchKey } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { RolesGuard } from '../src/common/guards'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import type { AttendanceService } from '../src/modules/attendance/attendance.service'
import { CenterService } from '../src/modules/center/center.service'
import { asCenter } from '../src/modules/center/admin-center.controller'
import { ContactsService } from '../src/modules/contacts/contacts.service'
import { ManageService } from '../src/modules/manage/manage.service'
import { RegistryService } from '../src/modules/registry/registry.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { StudentsService } from '../src/modules/students/students.service'
import { TrainingService } from '../src/modules/training/training.service'
import { VacanciesService } from '../src/modules/vacancies/vacancies.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'
import { type Route, routesOf } from './support/routes'

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

describe('API access matrix: center, teacher, student, company, Super Admin', () => {
  const guard = new RolesGuard(new Reflector())
  const passes = (r: Route, roles: string[]) => {
    try { return guard.canActivate(contextFor(r, roles)) } catch (err) {
      const status = (err as { getStatus?: () => number }).getStatus?.()
      if (status !== 403) throw new Error(`${key(r)}: ${String(err)} (status ${status})`)
      return false
    }
  }

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

  /** Runs every attempt and lists the ones that were not refused with 403 or 404. */
  async function refusedAll(w: World, attempts: Record<string, () => Promise<unknown>>) {
    const leaks: string[] = []
    for (const [name, attempt] of Object.entries(attempts)) {
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
})
