import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HttpException, type ArgumentsHost } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppExceptionFilter } from '../src/common/filters/app-exception.filter'
import { Prisma } from '../src/generated/prisma/client'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import { CenterStudentsService } from '../src/modules/center/center-students.service'
import { GradeInput, JournalQuery } from '../src/modules/classroom/classroom.schemas'
import { HomeworkService } from '../src/modules/classroom/homework.service'
import { JournalService } from '../src/modules/classroom/journal.service'
import { TenantsService } from '../src/modules/tenants/tenants.service'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * Проверка безопасности 20.11 (заметка «2026-11-20 Проверка безопасности ILMORA»), находки №6, №7, №8, №10 по коду
 * журнала и домашних заданий (PR #118: modules/classroom, CenterStudentsService.acceptInvite, миграция
 * 20261126000000_center_students_journal_homework). Only tests, no product fixes.
 *
 * A rule that already holds is asserted strictly. A rule the code breaks today is in KNOWN_GAP: while it is there the
 * test pins today's EXACT behaviour (todayObserved), so a partial or differently shaped fix trips «behaviour changed —
 * re-check the key» instead of staying silently green, and a full fix trips «finding closed, remove '<key>'». A key
 * left in KNOWN_GAP that no test checked fails the file (afterAll), so stale keys cannot pile up.
 *
 * Note only, not tested (product decision): the center may PATCH a record LEFT → STUDYING even when the student left by
 * himself (CenterStudentsService.leave) — then he is back on the list without asking.
 */
const KNOWN_GAP = new Set([
  'n6-cap', // №6: every hand-in is a new row, no cap per homework (homework.service submit)
  'n6-detail', // №6: the teacher's detail returns every hand-in of every student
  'n6-my-detail', // №6: the student's detail returns every own hand-in
  // №7 — closed 23.11 (Шерзод): the grade names the hand-in (submissionId), the service grades that one.
  'n10-month', // №10: month 9999-12 → nextMonth «10000-01» → Invalid Date → PrismaClientValidationError → 500
  'n10-mark-race', // №10: the second of two concurrent first marks of a cell throws raw P2002 from the service
  'n10-left-mark', // №10: setMark does not look at the record's status: a LEFT student can be marked
  'n10-patch-due', // №10: update() takes a past dueAt, create() refuses it
  'n10-accept-race', // №10: acceptInvite racing on unique [centerId, userId] throws raw P2002 from the service
])
/** Keys whose test needs no database (the others are checked in CI only). */
const NO_DB_KEYS = ['n7-schema']
const checked = new Set<string>()
/**
 * holds — the rule of the finding; todayObserved — exactly what today's code does (only looked at while gapped).
 */
function rule(key: string, holds: boolean, what: string, todayObserved: boolean, today: string) {
  checked.add(key)
  if (KNOWN_GAP.has(key)) {
    expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
    expect(todayObserved, `'${key}': behaviour changed — re-check the key (expected today: ${today})`).toBe(true)
  } else expect(holds, what).toBe(true)
}
afterAll(() => {
  const expected = [...KNOWN_GAP].filter((k) => DB_AVAILABLE || NO_DB_KEYS.includes(k))
  expect(expected.filter((k) => !checked.has(k)), 'KNOWN_GAP keys no test checked (stale or renamed)').toEqual([])
})

/**
 * №6: how many hand-ins of one student one homework keeps. The fix should use 20 (a student re-submits a few times, not
 * dozens); any cap up to SUBMISSIONS_CAP_MAX_ACCEPTED is accepted by these tests, whether the extra hand-in is refused
 * (any clean 4xx) or the oldest ones are dropped / duplicates merged — what counts is how many rows are kept.
 */
const SUBMISSIONS_CAP_SUGGESTED = 20
const SUBMISSIONS_CAP_MAX_ACCEPTED = 50

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown }
/** Success or an HTTP error (AppError / HttpException). Anything else is rethrown: a test bug, not an observation. */
const outcome = <T>(p: Promise<T>): Promise<Outcome> =>
  p.then((value) => ({ ok: true as const, value }), (error: unknown) => {
    if (error instanceof HttpException) return { ok: false as const, error }
    throw error
  })
/** Captures any error — only where the test deliberately inspects a raw Prisma error and asserts which one it is. */
const rawOutcome = <T>(p: Promise<T>): Promise<Outcome> => p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
/** A clean refusal: our AppError / a Nest HttpException with a 4xx status (not a raw Prisma error, not a 500). */
const isClean4xx = (e: unknown) => e instanceof HttpException && e.getStatus() >= 400 && e.getStatus() < 500
const isPrismaCode = (o: Outcome, code: string) => !o.ok && o.error instanceof Prisma.PrismaClientKnownRequestError && o.error.code === code
/** The status the client gets for an exception through the global filter (as test/app-exception-filter.test.ts does). */
const httpStatusOf = (exception: unknown) => {
  const out: { status?: number } = {}
  const res = { status: (s: number) => ((out.status = s), res), json: () => res, setHeader: () => res, getHeaders: () => ({}) }
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ headers: {}, originalUrl: '/x' }) }) } as unknown as ArgumentsHost
  new AppExceptionFilter().catch(exception, host)
  return out.status!
}
const describeOutcome = (o: Outcome) => (o.ok ? 'ok' : o.error instanceof HttpException ? `${o.error.getStatus()} ${(o.error as { code?: string }).code ?? ''}` : `raw ${(o.error as { code?: string; name?: string })?.code ?? (o.error as Error)?.name}`)

/**
 * №7: the ways a grade may name the hand-in it is for. The test sends the id of the hand-in the teacher read; if the fix
 * picks another name (or a route per hand-in), add it here / change gradeRead below — one place.
 */
const PIN_FIELDS = ['submissionId', 'expectedSubmissionId']

// ───────── without a database ─────────

describe('Классная комната, проверка 20.11 — без базы', () => {
  it('№7 schema: the grade can name the hand-in it is for', () => {
    // Sanity: without the field the same body is valid today, so a failure below is about the field only.
    expect(GradeInput.safeParse({ studentId: 'u1', grade: 4 }).success).toBe(true)
    const results = PIN_FIELDS.map((f) => GradeInput.safeParse({ studentId: 'u1', grade: 4, [f]: 's1' }))
    const accepted = results.some((r, i) => r.success && (r.data as Record<string, unknown>)[PIN_FIELDS[i]] === 's1')
    const allUnrecognized = results.every((r) => !r.success && r.error.issues.length === 1 && r.error.issues[0].code === 'unrecognized_keys')
    rule('n7-schema', accepted, `GradeInput accepts one of ${PIN_FIELDS.join(', ')}`, allUnrecognized, 'each field refused as unrecognized_keys (strict schema)')
  })

  it('№8 audit: homework.service writes each change and its audit in one transaction (audit.record gets tx)', () => {
    const src = readFileSync(join(__dirname, '../src/modules/classroom/homework.service.ts'), 'utf8')
    const calls = src.match(/this\.audit\.record\(\{[^}]*/g) ?? []
    // Sanity: create, update, delete, extend, grade, submit are audited — the regex finds them.
    expect(calls.length).toBeGreaterThanOrEqual(6)
    const outside = calls.filter((c) => !/^this\.audit\.record\(\{\s*tx\b/.test(c))
    rule('n8-audit-tx', outside.length === 0, `every audit.record in homework.service passes tx (outside: ${outside.length}/${calls.length})`, outside.length === calls.length && calls.length === 6, 'all 6 audit.record calls without tx')
  })

  it('№6: the suggested cap is within what the tests accept', () => {
    expect(SUBMISSIONS_CAP_SUGGESTED).toBeLessThanOrEqual(SUBMISSIONS_CAP_MAX_ACCEPTED)
  })

  it('№10 month: the journal query schema lets 9999-12 through (the service has to cope with it)', () => {
    // Recorded as is: the schema checks the shape only. The DB test below decides whether the answer is a 4xx.
    expect(JournalQuery.safeParse({ month: '9999-12' }).success).toBe(true)
  })
})

// ───────── with a database (CI) ─────────

describe.skipIf(!DB_AVAILABLE)('Классная комната, проверка 20.11 — с базой', () => {
  const ctx = new TestContext()
  const table = new CenterStudentsService(ctx.prisma, ctx.audit, new TenantsService(ctx.prisma, ctx.env), ctx.env)
  const journal = new JournalService(ctx.prisma, ctx.audit)
  const homework = new HomeworkService(ctx.prisma, ctx.audit)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const phone = () => `93${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
  const adult = (extra: Record<string, unknown> = {}) => ({ fullName: 'Aziz Karimov', phone: phone(), birthDate: '2001-05-04', ...extra })

  async function setup(label = 'cls') {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    return TenantContext.forTenant(t.tenantId, async () => {
      await db.center.update({ where: { id: t.center.id }, data: { status: 'ACTIVE', approvedAt: new Date() } })
      const admin = await db.user.create({ data: { tenantId: t.tenantId, login: `adm-${t.tenantId}`, displayName: 'Admin', roles: ['CENTER_ADMIN'], centerId: t.center.id } })
      const center: RequestActor = { id: admin.id, roles: ['CENTER_ADMIN'], centerId: t.center.id }
      const teacher: RequestActor = { id: t.teacherUser.id, roles: ['TEACHER'], teacherProfileId: t.teacher.id, centerId: t.center.id }
      return { t, center, teacher, tenantId: t.tenantId }
    })
  }
  type S = Awaited<ReturnType<typeof setup>>
  const as = <T>(s: S, actor: RequestActor, fn: () => Promise<T>) => TenantContext.forTenant(s.tenantId, fn, { actor })
  const inTenant = <T>(s: S, fn: () => Promise<T>) => TenantContext.forTenant(s.tenantId, fn)
  /** An ILMORA subscriber enrolled in a group (active), as a settled checkout leaves them. */
  async function subscriber(s: S) {
    const user = await ctx.makeStudent(s.tenantId)
    await inTenant(s, async () => {
      const sub = await ctx.prisma.client.subscription.create({ data: { tenantId: s.tenantId, studentId: user.id, status: 'ACTIVE' } })
      await ctx.prisma.client.enrollment.create({ data: { tenantId: s.tenantId, subscriptionId: sub.id, studentId: user.id, groupId: s.t.group.id, courseId: s.t.course.id, status: 'ACTIVE', enrolledAt: new Date('2026-01-01T00:00:00.000Z') } })
    })
    return { user, actor: { id: user.id, roles: ['STUDENT'] } as RequestActor }
  }
  const giveHomework = (s: S, modes: ('TEXT' | 'LINK')[] = ['TEXT', 'LINK']) =>
    as(s, s.teacher, () => homework.create(s.teacher, { groupId: s.t.group.id, title: 'Vazifa', description: 'Matn', dueAt: new Date(Date.now() + 86_400_000).toISOString(), submitModes: modes }))
  const pastLesson = (s: S, day = '2026-02-02') =>
    inTenant(s, () => ctx.prisma.client.lessonSession.create({ data: { tenantId: s.tenantId, groupId: s.t.group.id, courseId: s.t.course.id, date: new Date(`${day}T00:00:00.000Z`), startsAt: new Date(`${day}T13:00:00.000Z`), endsAt: new Date(`${day}T14:30:00.000Z`), status: 'COMPLETED' } }))
  /**
   * A PrismaService whose next tx() first runs `before` on the real client and commits it — another request that won the
   * race between the service's read and its write. Deterministic, no timing.
   */
  function racing(before: () => Promise<unknown>) {
    const state = { fired: false }
    const prisma = Object.create(ctx.prisma) as PrismaService
    prisma.tx = (async (fn: never, opts?: never) => {
      if (!state.fired) {
        state.fired = true
        await before()
      }
      return ctx.prisma.tx(fn, opts)
    }) as PrismaService['tx']
    return { prisma, state }
  }

  // ───────── №6 ─────────

  it('№6 cap: one student keeps at most a bounded number of hand-ins per homework; refusals are clean', async () => {
    const s = await setup()
    const hw = await giveHomework(s)
    const { actor: me } = await subscriber(s)
    const attempts = SUBMISSIONS_CAP_MAX_ACCEPTED + 1
    const outcomes: Outcome[] = []
    // outcome() rethrows anything that is not an HTTP error: a raw error fails the test right here.
    for (let i = 0; i < attempts; i++) outcomes.push(await outcome(as(s, me, () => homework.submit(me, hw.id, { text: `v${i}` }))))
    // Sanity: the first hand-in is taken (the setup works).
    expect(outcomes[0].ok).toBe(true)
    const refused = outcomes.filter((o) => !o.ok)
    expect(refused.filter((o) => !isClean4xx(o.error)).map(describeOutcome), 'a refusal is a clean 4xx').toEqual([])
    const stored = await inTenant(s, () => ctx.prisma.client.homeworkSubmission.count({ where: { homeworkId: hw.id, studentId: me.id } }))
    rule('n6-cap', stored <= SUBMISSIONS_CAP_MAX_ACCEPTED, `after ${attempts} hand-ins at most ${SUBMISSIONS_CAP_MAX_ACCEPTED} are kept (kept: ${stored}, refused: ${refused.length})`,
      stored === attempts && refused.length === 0, `all ${attempts} taken and stored`)
  })

  it('№6 detail: the teacher\'s and the student\'s detail return a bounded number of hand-ins per student', async () => {
    const s = await setup()
    const hw = await giveHomework(s)
    const { actor: me } = await subscriber(s)
    await as(s, me, () => homework.submit(me, hw.id, { text: 'first' }))
    // Many hand-ins already stored (as today's code lets them pile up), older than the first one.
    const many = 60
    await inTenant(s, () => ctx.prisma.client.homeworkSubmission.createMany({
      data: Array.from({ length: many }, (_, i) => ({ tenantId: s.tenantId, homeworkId: hw.id, studentId: me.id, text: `old ${i}`, submittedAt: new Date(Date.now() - (i + 1) * 60_000) })),
    }))
    const total = many + 1
    const detail = await as(s, s.teacher, () => homework.detail(s.teacher, hw.id))
    const row = detail.students.find((x) => x.id === me.id)!
    // Sanity: the student is on the list and the latest hand-in is shown.
    expect(row.last).toMatchObject({ text: 'first' })
    const shown = 1 + row.history.length
    rule('n6-detail', shown <= SUBMISSIONS_CAP_MAX_ACCEPTED, `teacher detail shows at most ${SUBMISSIONS_CAP_MAX_ACCEPTED} hand-ins of a student (shows ${shown} of ${total})`, shown === total, `all ${total} returned`)
    const mine = await as(s, me, () => homework.myDetail(me, hw.id))
    expect(mine.submissions[0]).toMatchObject({ text: 'first' })
    const own = mine.submissions.length
    rule('n6-my-detail', own <= SUBMISSIONS_CAP_MAX_ACCEPTED, `student detail shows at most ${SUBMISSIONS_CAP_MAX_ACCEPTED} own hand-ins (shows ${own} of ${total})`, own === total, `all ${total} returned`)
  })

  // ───────── №7 ─────────

  it('№7: the grade goes to the hand-in the teacher read, not to one that landed meanwhile', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const hw = await giveHomework(s)
    const { actor: me } = await subscriber(s)
    const first = await as(s, me, () => homework.submit(me, hw.id, { text: 'v1' }))
    await inTenant(s, () => db.homeworkSubmission.update({ where: { id: first.id }, data: { submittedAt: new Date(Date.now() - 60_000) } }))
    // The teacher opens the list and reads v1 …
    const read = (await as(s, s.teacher, () => homework.detail(s.teacher, hw.id))).students.find((x) => x.id === me.id)!.last!
    expect(read.id).toBe(first.id)
    // … the student hands in v2 …
    const second = await as(s, me, () => homework.submit(me, hw.id, { text: 'v2' }))
    // … the teacher grades what was read, naming it every way PIN_FIELDS lists (today's service ignores them all).
    const gradeRead = () => homework.grade(s.teacher, hw.id, { studentId: me.id, grade: 4, ...Object.fromEntries(PIN_FIELDS.map((f) => [f, read.id])) } as never)
    const o = await outcome(as(s, s.teacher, gradeRead))
    const [g1, g2] = await inTenant(s, () => Promise.all([db.homeworkSubmission.findUniqueOrThrow({ where: { id: first.id } }), db.homeworkSubmission.findUniqueOrThrow({ where: { id: second.id } })]))
    // Pinned either way: v1 gets the grade, or the grade is refused cleanly because a newer hand-in exists — never v2.
    const holds = g2.grade === null && ((o.ok && g1.grade === 4) || (!o.ok && isClean4xx(o.error) && g1.grade === null))
    rule('n7', holds, `v2 (newer) stays ungraded; v1 (read) graded or a clean refusal — got ${describeOutcome(o)}, v1=${g1.grade}, v2=${g2.grade}`,
      o.ok && g1.grade === null && g2.grade === 4, 'grade accepted and landed on v2, v1 ungraded')
  })

  // ───────── №8 ─────────

  it('№8: the database itself refuses to delete a homework that has hand-ins (its extensions stay too); the service answers 409', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const hw = await giveHomework(s)
    const { user, actor: me } = await subscriber(s)
    const sub = await as(s, me, () => homework.submit(me, hw.id, { text: 'work' }))
    await as(s, s.teacher, () => homework.extend(s.teacher, hw.id, { studentId: user.id, dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }))
    // Holds today: the service checks first.
    const viaService = await outcome(as(s, s.teacher, () => homework.remove(s.teacher, hw.id)))
    expect(describeOutcome(viaService)).toBe('409 homework_has_submissions')
    // The check and the delete are two statements: what stops a hand-in landing between them is the foreign key.
    const direct = await rawOutcome(inTenant(s, () => db.homework.delete({ where: { id: hw.id } })))
    // P2003 (foreign key) / P2014 (required relation) — the shapes Prisma gives a RESTRICT refusal.
    if (!direct.ok) expect(isPrismaCode(direct, 'P2003') || isPrismaCode(direct, 'P2014'), `refused by the foreign key, not something else (${describeOutcome(direct)})`).toBe(true)
    const left = await inTenant(s, async () => ({ hw: await db.homework.count({ where: { id: hw.id } }), sub: await db.homeworkSubmission.count({ where: { id: sub.id } }), ext: await db.homeworkExtension.count({ where: { homeworkId: hw.id } }) }))
    rule('n8-restrict', !direct.ok && left.hw === 1 && left.sub === 1 && left.ext === 1,
      `deleting a homework with a hand-in straight in the DB is refused (got ${describeOutcome(direct)}, left: homework ${left.hw}, hand-in ${left.sub}, extension ${left.ext})`,
      direct.ok && left.hw === 0 && left.sub === 0 && left.ext === 0, 'delete succeeded, hand-in and extension cascaded away')
  })

  it('№8: a homework with an extension but no hand-ins is still deleted by the service (extension alone is not RESTRICT)', async () => {
    // Why HomeworkExtension is not RESTRICT on its own: remove() lets the teacher delete a homework nobody handed in, and an
    // extension is the teacher's own setting, not the students' work. Under n8-restrict the extension is protected
    // because the hand-in blocks the delete. Holds today, asserted strictly — a fix must keep it.
    const s = await setup()
    const db = ctx.prisma.client
    const hw = await giveHomework(s)
    const { user } = await subscriber(s)
    await as(s, s.teacher, () => homework.extend(s.teacher, hw.id, { studentId: user.id, dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }))
    await expect(as(s, s.teacher, () => homework.remove(s.teacher, hw.id))).resolves.toEqual({ ok: true })
    expect(await inTenant(s, () => db.homework.count({ where: { id: hw.id } }))).toBe(0)
  })

  // ───────── №10 ─────────

  it('№10 month: the journal for 9999-12 is a 4xx (or an empty month), never a 500', async () => {
    const s = await setup()
    // Sanity: an ordinary month works.
    await expect(as(s, s.teacher, () => journal.journal(s.t.group.id, s.teacher, '2026-02'))).resolves.toMatchObject({ month: '2026-02' })
    const schemaRefuses = !JournalQuery.safeParse({ month: '9999-12' }).success
    // Raw on purpose: today the service lets a Prisma validation error out.
    const o = await rawOutcome(as(s, s.teacher, () => journal.journal(s.t.group.id, s.teacher, '9999-12')))
    const holds = schemaRefuses || o.ok || isClean4xx(o.error)
    rule('n10-month', holds, `GET journal?month=9999-12 is not a 500 (service: ${describeOutcome(o)}${o.ok ? '' : `, client gets ${httpStatusOf(o.error)}`})`,
      !o.ok && o.error instanceof Prisma.PrismaClientValidationError && httpStatusOf(o.error) === 500, 'PrismaClientValidationError (Invalid Date), the client gets 500')
  })

  it('№10 mark race: two first marks of the same cell — the loser gets a clean 4xx, not a raw Prisma error', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const own = await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ groupIds: [s.t.group.id], startedOn: '2026-01-01' }) as never))
    const lesson = await pastLesson(s)
    // The other request (the center admin) marks the cell after our read of «no mark yet», before our write.
    const { prisma, state } = racing(() => inTenant(s, () => db.centerAttendanceMark.create({ data: { tenantId: s.tenantId, sessionId: lesson.id, centerStudentId: own.student.id, status: 'ABSENT', markedById: s.center.id } })))
    const racer = new JournalService(prisma, ctx.audit)
    // Raw on purpose: today a P2002 comes out of the service.
    const o = await rawOutcome(as(s, s.teacher, () => racer.setMark(s.t.group.id, s.teacher, { sessionId: lesson.id, centerStudentId: own.student.id, status: 'PRESENT' })))
    // Sanity: the race was staged (setMark writes in prisma.tx) and the cell has exactly one mark.
    expect(state.fired).toBe(true)
    expect(await inTenant(s, () => db.centerAttendanceMark.count({ where: { sessionId: lesson.id, centerStudentId: own.student.id } }))).toBe(1)
    // Holds today: the global filter turns P2002 into a generic 409, so the client never sees a 500.
    if (!o.ok) expect(httpStatusOf(o.error), `client status (${describeOutcome(o)})`).toBeLessThan(500)
    rule('n10-mark-race', o.ok || isClean4xx(o.error), `the losing setMark succeeds or is a clean AppError 4xx (got ${describeOutcome(o)})`, isPrismaCode(o, 'P2002'), 'raw Prisma P2002 from the service')
  })

  it('№10 LEFT: no marks for a center student who left (archive)', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const own = await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ groupIds: [s.t.group.id], startedOn: '2026-01-01' }) as never))
    const lesson = await pastLesson(s)
    // Sanity: while studying, the mark is taken.
    await as(s, s.teacher, () => journal.setMark(s.t.group.id, s.teacher, { sessionId: lesson.id, centerStudentId: own.student.id, status: 'PRESENT' }))
    await as(s, s.teacher, () => journal.setMark(s.t.group.id, s.teacher, { sessionId: lesson.id, centerStudentId: own.student.id, status: null }))
    await inTenant(s, () => db.centerStudent.update({ where: { id: own.student.id }, data: { status: 'LEFT', archivedAt: new Date() } }))
    const o = await outcome(as(s, s.teacher, () => journal.setMark(s.t.group.id, s.teacher, { sessionId: lesson.id, centerStudentId: own.student.id, status: 'PRESENT' })))
    const marks = await inTenant(s, () => db.centerAttendanceMark.count({ where: { sessionId: lesson.id, centerStudentId: own.student.id } }))
    rule('n10-left-mark', !o.ok && isClean4xx(o.error) && marks === 0, `marking a LEFT student is a clean 4xx and leaves no mark (got ${describeOutcome(o)}, marks ${marks})`,
      o.ok && marks === 1, 'mark accepted and stored')
  })

  it('№10 patch: a past deadline is refused on edit as on create', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const hw = await giveHomework(s)
    const past = new Date(Date.now() - 60_000).toISOString()
    // Holds today: create refuses it.
    expect(describeOutcome(await outcome(as(s, s.teacher, () => homework.create(s.teacher, { groupId: s.t.group.id, title: 'X', description: 'Y', dueAt: past, submitModes: ['TEXT'] }))))).toBe('422 homework_due_past')
    // Sanity: a future deadline is taken on edit.
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString()
    await as(s, s.teacher, () => homework.update(s.teacher, hw.id, { dueAt: later }))
    const o = await outcome(as(s, s.teacher, () => homework.update(s.teacher, hw.id, { dueAt: past })))
    const due = (await inTenant(s, () => db.homework.findUniqueOrThrow({ where: { id: hw.id } }))).dueAt.toISOString()
    rule('n10-patch-due', !o.ok && isClean4xx(o.error) && due === later, `PATCH dueAt in the past is a clean 4xx and the deadline stays (got ${describeOutcome(o)}, dueAt ${due})`,
      o.ok && due === past, 'past deadline accepted and stored')
  })

  it('№10 accept race: a record of the same center and account landing meanwhile — a clean 4xx (409), not raw P2002', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const rec = await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ groupIds: [s.t.group.id] }) as never))
    const token = new URL((await as(s, s.center, () => table.invite(s.tenantId, s.center, rec.student.id))).url).hash.slice(1)
    const user = await ctx.makeStudent(s.tenantId)
    const me: RequestActor = { id: user.id, roles: ['STUDENT'] }
    // Another acceptance (or the ILMORA sync) links the same account to this center after our «not on the list» read.
    const { prisma, state } = racing(() => inTenant(s, () => db.centerStudent.create({ data: { tenantId: s.tenantId, centerId: s.t.center.id, fullName: 'Race', userId: user.id, source: 'ILMORA' } })))
    const racer = new CenterStudentsService(prisma, ctx.audit, new TenantsService(ctx.prisma, ctx.env), ctx.env)
    // Raw on purpose: today a P2002 comes out of the service.
    const o = await rawOutcome(as(s, me, () => racer.acceptInvite(s.tenantId, me, { token })))
    // Sanity: the race was staged and the account is on this center's list once.
    expect(state.fired).toBe(true)
    expect(await inTenant(s, () => db.centerStudent.count({ where: { centerId: s.t.center.id, userId: user.id } }))).toBe(1)
    // Holds today: through the global filter P2002 is a 409, not a 500.
    if (!o.ok) expect(httpStatusOf(o.error), `client status (${describeOutcome(o)})`).toBeLessThan(500)
    rule('n10-accept-race', o.ok || isClean4xx(o.error), `the racing acceptInvite succeeds or is a clean AppError 4xx (got ${describeOutcome(o)})`, isPrismaCode(o, 'P2002'), 'raw Prisma P2002 from the service')
  })
})
