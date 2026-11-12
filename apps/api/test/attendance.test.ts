import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sha256 } from '../src/common/crypto'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { AttendanceEvents } from '../src/modules/attendance/attendance.events'
import { AttendanceService } from '../src/modules/attendance/attendance.service'
import { SessionsService } from '../src/modules/sessions/sessions.service'
import { TenantsService } from '../src/modules/tenants/tenants.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

/** Redis is not required for these tests: publishing is a no-op stub. */
const events = { publish: async () => undefined } as unknown as AttendanceEvents

describe.skipIf(!DB_AVAILABLE)('attendance: sessions, tokens, check-in rules', () => {
  const ctx = new TestContext()
  const tenants = new TenantsService(ctx.prisma, ctx.env)
  const sessions = new SessionsService(ctx.prisma, tenants, ctx.env)
  const attendance = new AttendanceService(ctx.prisma, ctx.audit, events, tenants, ctx.subscriptions, notificationsStub, ctx.env)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  async function setup() {
    const t = await ctx.makeTenant('att')
    const student = await ctx.makeStudent(t.tenantId)
    const other = await ctx.makeStudent(t.tenantId)
    const { payment } = await ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])
    await TenantContext.forTenant(t.tenantId, () => ctx.prisma.tx((tx) => ctx.payments.settle(tx, { paymentId: payment.id, provider: 'MANUAL', providerTransactionId: `m-${payment.id}`, performedAt: new Date() })))
    const teacher = { id: t.teacherUser.id, roles: ['TEACHER' as const], teacherProfileId: t.teacher.id, centerId: null }
    const stranger = { id: 'x', roles: ['TEACHER' as const], teacherProfileId: 'someone-else', centerId: null }
    const today = sessions.todayLocal()
    const group = await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.group.findFirst({ where: { id: t.group.id } }))
    await TenantContext.forTenant(t.tenantId, () => sessions.generateForGroup(group!, today, 14, 'test'))
    const session = await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.lessonSession.findFirst({ where: { groupId: t.group.id }, orderBy: { startsAt: 'asc' } }))
    return { t, student, other, teacher, stranger, session: session!, group: group! }
  }

  it('a blocked center no longer opens attendance, moves or adds lessons (the Super Admin still can)', async () => {
    const { t, teacher, session } = await setup()
    await TenantContext.system(() => ctx.prisma.client.center.update({ where: { id: t.center.id }, data: { status: 'BLOCKED' } }), { tenantId: t.tenantId })
    const blocked = { details: { code: 'center_blocked' } }
    await expect(TenantContext.forTenant(t.tenantId, () => attendance.open(session.id, teacher))).rejects.toMatchObject(blocked)
    await expect(TenantContext.forTenant(t.tenantId, () => attendance.setStatus(session.id, 'cancelled', teacher))).rejects.toMatchObject(blocked)
    await expect(TenantContext.forTenant(t.tenantId, () => attendance.rescheduleSession(session.id, teacher, { start: '09:00', end: '10:00' }))).rejects.toMatchObject(blocked)
    await expect(TenantContext.forTenant(t.tenantId, () => attendance.addExtraSession(t.group.id, teacher, { date: '2030-01-07', start: '09:00', end: '10:00' }))).rejects.toMatchObject(blocked)
    const owner = { id: 'u-owner', roles: ['PLATFORM_ADMIN' as const], centerId: null }
    await expect(TenantContext.forTenant(t.tenantId, () => attendance.open(session.id, owner))).resolves.toBeTruthy()
  })

  it('re-check 11.11 №86: a scanned center code that is unknown or changed is 404, a blocked center 403 — never an empty 200', async () => {
    const t = await ctx.makeTenant('att-86')
    await TenantContext.forTenant(t.tenantId, async () => {
      const db = ctx.prisma.client
      const center = await db.center.update({ where: { id: t.center.id }, data: { checkInCode: `poster-${t.tenantId}` } })
      expect(await attendance.describeCenterCode(center.checkInCode!)).toMatchObject({ center: { id: center.id } })
      const status = (p: Promise<unknown>) => p.then(() => 200, (e: { code: string; getStatus: () => number }) => `${e.getStatus()} ${e.code}`)
      expect(await status(attendance.describeCenterCode('old-poster-code'))).toBe('404 center_code_invalid')
      await expect(attendance.describeCenterCode('')).rejects.toMatchObject({ code: 'center_code_invalid' })
      await db.center.update({ where: { id: center.id }, data: { status: 'BLOCKED' } })
      expect(await status(attendance.describeCenterCode(center.checkInCode!))).toBe('403 center_blocked')
    })
  })

  it('session generation is idempotent and never creates attendance', async () => {
    const { t, group } = await setup()
    const before = await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.lessonSession.count({ where: { groupId: group.id } }))
    const added = await TenantContext.forTenant(t.tenantId, () => sessions.generateForGroup(group, sessions.todayLocal(), 14, 'test-again'))
    expect(added).toBe(0)
    expect(await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.lessonSession.count({ where: { groupId: group.id } }))).toBe(before)
    expect(await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.attendanceRecord.count({}))).toBe(0)
  })

  it('daily job runs are exclusive per key (JobRun unique constraint)', async () => {
    const key = `test-${Date.now()}`
    const first = await TenantContext.system(() => ctx.prisma.client.jobRun.create({ data: { queue: 'sessions', jobKey: key } }))
    expect(first.id).toBeDefined()
    await expect(TenantContext.system(() => ctx.prisma.client.jobRun.create({ data: { queue: 'sessions', jobKey: key } }))).rejects.toMatchObject({ code: 'P2002' })
  })

  it('enforces ownership, token validity, enrollment, open window and idempotency', async () => {
    const { t, student, other, teacher, stranger, session } = await setup()
    const asTenant = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn, { actor: teacher })

    await expect(asTenant(() => attendance.open(session.id, stranger))).rejects.toMatchObject({ code: 'forbidden' })
    // closed: a scan before the teacher opens attendance is rejected — the group's student is told it is closed (Н16)
    expect(await asTenant(() => attendance.checkIn(student.id, { sessionId: session.id, token: 'whatever' }, {}))).toMatchObject({ ok: false, reason: 'closed' })

    const opened = await asTenant(() => attendance.open(session.id, teacher))
    expect(opened.url).toContain(`/attend/${session.id}?t=${opened.token}`)
    const stored = await asTenant(() => ctx.prisma.client.lessonSession.findFirst({ where: { id: session.id } }))
    expect(stored?.attendanceTokenHash).toBe(sha256(opened.token))

    expect(await asTenant(() => attendance.checkIn(student.id, { sessionId: session.id, token: 'wrong-token' }, {}))).toMatchObject({ ok: false, reason: 'invalid-link' })
    expect(await asTenant(() => attendance.checkIn(other.id, { sessionId: session.id, token: opened.token }, {}))).toMatchObject({ ok: false, reason: 'not-enrolled' })

    const first = await asTenant(() => attendance.checkIn(student.id, { sessionId: session.id, token: opened.token }, { ip: '1.1.1.1' }))
    expect(first).toMatchObject({ ok: true, alreadyRecorded: false })
    const again = await asTenant(() => attendance.checkIn(student.id, { sessionId: session.id, token: opened.token }, {}))
    expect(again).toMatchObject({ ok: true, alreadyRecorded: true })
    if (first.ok && again.ok) expect(again.record.checkedInAt).toBe(first.record.checkedInAt)

    // QR rotation invalidates the old token for new scans but existing records stay
    const rotated = await asTenant(() => attendance.qr(session.id, teacher))
    expect(rotated.token).not.toBe(opened.token)
    expect(await asTenant(() => attendance.checkIn(student.id, { sessionId: session.id, token: opened.token }, {}))).toMatchObject({ ok: true, alreadyRecorded: true })

    await asTenant(() => attendance.close(session.id, teacher))
    const closed = await asTenant(() => ctx.prisma.client.lessonSession.findFirst({ where: { id: session.id } }))
    expect(closed?.attendanceOpen).toBe(false)
    expect(closed?.attendanceTokenHash).toBeNull()
    expect(await asTenant(() => attendance.checkIn(other.id, { sessionId: session.id, token: rotated.token }, {}))).toMatchObject({ ok: false })

    // teacher correction requires a reason and leaves an audit trail
    const corrected = await asTenant(() => attendance.correct(session.id, teacher, { studentId: student.id, status: 'EXCUSED', reason: 'Doctor note' }))
    expect(corrected.status).toBe('excused')
    expect(corrected.checkedInAt).toBe(first.ok ? first.record.checkedInAt : '')
    const audits = await asTenant(() => ctx.prisma.client.auditEvent.findMany({ where: { entityType: 'AttendanceRecord', entityId: corrected.id } }))
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['attendance.check_in', 'attendance.correct']))
  })

  it('concurrent scans from two devices produce a single record', async () => {
    const { t, student, teacher, session } = await setup()
    const asTenant = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn, { actor: teacher })
    const opened = await asTenant(() => attendance.open(session.id, teacher))
    const results = await Promise.all([1, 2, 3, 4].map(() => asTenant(() => attendance.checkIn(student.id, { sessionId: session.id, token: opened.token }, {}))))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results.filter((r) => r.ok && !r.alreadyRecorded)).toHaveLength(1)
    expect(await asTenant(() => ctx.prisma.client.attendanceRecord.count({ where: { sessionId: session.id } }))).toBe(1)
  })
})
