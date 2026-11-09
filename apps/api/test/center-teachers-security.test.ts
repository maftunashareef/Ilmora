import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import type { AttendanceService } from '../src/modules/attendance/attendance.service'
import { CenterService } from '../src/modules/center/center.service'
import { ManageService } from '../src/modules/manage/manage.service'
import type { NotificationsService } from '../src/modules/notifications/notifications.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

/**
 * Centers and teachers (security review of the center workspace):
 *  - a center that waits for approval cannot link or edit registered teachers;
 *  - an approved center only invites; the teacher joins after accepting; the answer does not tell whether a login exists;
 *  - a blocked center cannot change courses, prices or groups, and its courses cannot be bought;
 *  - an approved center's new name waits for the Super Admin, and the audit log keeps every changed field.
 */
describe.skipIf(!DB_AVAILABLE)('centers and teachers against PostgreSQL', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const sent: { type: string; userIds: string[] }[] = []
  const notifications = { ...notificationsStub, notify: async (n: { type: string; userIds: string[] }) => { sent.push(n); return n.userIds.length } } as unknown as NotificationsService
  const centers = () => new CenterService(ctx.prisma, ctx.audit, {} as unknown as AttendanceService, notifications)
  const manage = () =>
    new ManageService(
      ctx.prisma,
      ctx.audit,
      { generateForGroup: async () => 0, todayLocal: () => '2026-11-09' } as unknown as SessionsService,
      { get: async () => ({ permissions: { teacher: { editCourses: true, editPrices: true, publishDirectly: true, manageGroups: true, editSchedules: true } } }) } as unknown as SiteService,
      notifications,
      ctx.env,
    )
  const owner: RequestActor = { id: 'u-owner', roles: ['PLATFORM_ADMIN'], centerId: null }

  /** A tenant with a second, self-registered center (status as given) and a registered teacher without a center. */
  async function world(status: 'PENDING' | 'ACTIVE' | 'BLOCKED') {
    const t = await ctx.makeTenant('cts')
    const s = randomUUID().slice(0, 8)
    return TenantContext.system(async () => {
      const db = ctx.prisma.client
      const center = await db.center.create({ data: { tenantId: t.tenantId, slug: `new-${s}`, name: 'Yangi markaz', district: {}, description: {}, status } })
      const adminUser = await db.user.create({ data: { tenantId: t.tenantId, login: `center-${s}`, displayName: 'Center admin', roles: ['CENTER_ADMIN'], centerId: center.id } })
      const teacherUser = await db.user.create({ data: { tenantId: t.tenantId, login: `ustoz-${s}`, displayName: 'Ustoz', roles: ['TEACHER', 'STUDENT'] } })
      const teacher = await db.teacherProfile.create({ data: { tenantId: t.tenantId, userId: teacherUser.id, slug: `ustoz-${s}`, name: 'Ustoz', title: { uz: 'Matematika', ru: 'Математика', en: 'Maths' }, bio: {}, tagline: {}, centerId: null } })
      const admin: RequestActor = { id: adminUser.id, roles: ['CENTER_ADMIN'], centerId: center.id }
      const teacherActor: RequestActor = { id: teacherUser.id, roles: ['TEACHER', 'STUDENT'], centerId: null, teacherProfileId: teacher.id }
      return { ...t, baseCenter: t.center, s, center, admin, teacherUser, teacher, teacherActor }
    }, { tenantId: t.tenantId })
  }
  const inTenant = <T>(tenantId: string, fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn)
  const profileOf = (w: { tenantId: string; teacher: { id: string } }) => inTenant(w.tenantId, () => ctx.prisma.client.teacherProfile.findFirstOrThrow({ where: { id: w.teacher.id } }))

  it('a center waiting for approval cannot link a registered teacher', async () => {
    const w = await world('PENDING')
    await expect(inTenant(w.tenantId, () => centers().addTeacher(w.tenantId, w.admin, { name: 'Ustoz', login: `ustoz-${w.s}` }))).rejects.toMatchObject({ details: { code: 'center_not_approved' } })
    expect((await profileOf(w)).centerId).toBeNull()
    // A placeholder profile without an account can still be prepared before approval.
    await expect(inTenant(w.tenantId, () => centers().addTeacher(w.tenantId, w.admin, { name: 'Yangi öqituvçi' }))).resolves.toMatchObject({ name: 'Yangi öqituvçi' })
  })

  it('an approved center only invites: the teacher joins after accepting, and the profile is not rewritten', async () => {
    const w = await world('ACTIVE')
    sent.length = 0
    const answer = await inTenant(w.tenantId, () => centers().addTeacher(w.tenantId, w.admin, { name: 'Boshqa ism', login: `ustoz-${w.s}`, title: { uz: 'X', ru: 'X', en: 'X' } }))
    expect(answer).toEqual({ invited: true })
    let profile = await profileOf(w)
    expect(profile.centerId).toBeNull()
    expect(profile.title).toEqual({ uz: 'Matematika', ru: 'Математика', en: 'Maths' })
    expect(sent.map((n) => n.type)).toEqual(['center.teacherInvited'])
    expect(sent[0].userIds).toEqual([w.teacherUser.id])

    const invites = await inTenant(w.tenantId, () => centers().myInvites(w.tenantId, w.teacherActor))
    expect(invites).toHaveLength(1)
    expect(invites[0]).toMatchObject({ centerId: w.center.id, centerName: 'Yangi markaz' })
    // Somebody else cannot answer the invitation.
    await expect(inTenant(w.tenantId, () => centers().respondInvite(w.tenantId, w.admin, invites[0].id, true))).rejects.toMatchObject({ status: 404 })
    await inTenant(w.tenantId, () => centers().respondInvite(w.tenantId, w.teacherActor, invites[0].id, true))
    profile = await profileOf(w)
    expect(profile.centerId).toBe(w.center.id)
    expect(profile.name).toBe('Ustoz')
    const account = await inTenant(w.tenantId, () => ctx.prisma.client.user.findFirstOrThrow({ where: { id: w.teacherUser.id } }))
    expect(account.displayName).toBe('Ustoz')
  })

  it('a declined invitation leaves the teacher where they were and is not sent again', async () => {
    const w = await world('ACTIVE')
    await inTenant(w.tenantId, () => centers().addTeacher(w.tenantId, w.admin, { name: 'Ustoz', login: `ustoz-${w.s}` }))
    const [invite] = await inTenant(w.tenantId, () => centers().myInvites(w.tenantId, w.teacherActor))
    await inTenant(w.tenantId, () => centers().respondInvite(w.tenantId, w.teacherActor, invite.id, false))
    expect((await profileOf(w)).centerId).toBeNull()
    sent.length = 0
    await inTenant(w.tenantId, () => centers().addTeacher(w.tenantId, w.admin, { name: 'Ustoz', login: `ustoz-${w.s}` }))
    expect(sent).toHaveLength(0)
    expect(await inTenant(w.tenantId, () => centers().myInvites(w.tenantId, w.teacherActor))).toHaveLength(0)
  })

  it('answers the same whether the login is unknown, belongs to a teacher of another center or is a student', async () => {
    const w = await world('ACTIVE')
    const elsewhere = await TenantContext.system(async () => {
      const u = await ctx.prisma.client.user.create({ data: { tenantId: w.tenantId, login: `busy-${w.s}`, displayName: 'Busy', roles: ['TEACHER'] } })
      await ctx.prisma.client.teacherProfile.create({ data: { tenantId: w.tenantId, userId: u.id, slug: `busy-${w.s}`, name: 'Busy', title: {}, bio: {}, tagline: {}, centerId: w.baseCenter.id } })
      await ctx.prisma.client.user.create({ data: { tenantId: w.tenantId, login: `pupil-${w.s}`, displayName: 'Pupil', roles: ['STUDENT'] } })
      return u
    }, { tenantId: w.tenantId })
    sent.length = 0
    for (const login of [`nobody-${w.s}`, `busy-${w.s}`, `pupil-${w.s}`]) {
      await expect(inTenant(w.tenantId, () => centers().addTeacher(w.tenantId, w.admin, { name: 'X', login }))).resolves.toEqual({ invited: true })
    }
    expect(sent).toHaveLength(0)
    const profile = await inTenant(w.tenantId, () => ctx.prisma.client.teacherProfile.findFirstOrThrow({ where: { userId: elsewhere.id } }))
    expect(profile.centerId).not.toBe(w.center.id)
  })

  it('a center waiting for approval cannot edit a profile behind somebody’s account, and no center renames the account', async () => {
    const pending = await world('PENDING')
    await TenantContext.system(() => ctx.prisma.client.teacherProfile.update({ where: { id: pending.teacher.id }, data: { centerId: pending.center.id } }), { tenantId: pending.tenantId })
    await expect(inTenant(pending.tenantId, () => centers().updateTeacher(pending.tenantId, pending.admin, pending.teacher.id, { name: 'Boshqa' }))).rejects.toMatchObject({ details: { code: 'center_not_approved' } })

    const active = await world('ACTIVE')
    await TenantContext.system(() => ctx.prisma.client.teacherProfile.update({ where: { id: active.teacher.id }, data: { centerId: active.center.id } }), { tenantId: active.tenantId })
    await inTenant(active.tenantId, () => centers().updateTeacher(active.tenantId, active.admin, active.teacher.id, { name: 'Profil nomi' }))
    const account = await inTenant(active.tenantId, () => ctx.prisma.client.user.findFirstOrThrow({ where: { id: active.teacherUser.id } }))
    expect(account.displayName).toBe('Ustoz')
  })

  it('a blocked center cannot change its courses, prices or groups, and its groups cannot be bought', async () => {
    const t = await ctx.makeTenant('blk')
    const admin: RequestActor = { id: 'u-blk-admin', roles: ['CENTER_ADMIN'], centerId: t.center.id }
    const teacher: RequestActor = { id: t.teacherUser.id, roles: ['TEACHER'], centerId: t.center.id, teacherProfileId: t.teacher.id }
    await TenantContext.system(() => ctx.prisma.client.center.update({ where: { id: t.center.id }, data: { status: 'BLOCKED' } }), { tenantId: t.tenantId })
    const blocked = { details: { code: 'center_blocked' } }
    await expect(inTenant(t.tenantId, () => manage().updateCourse(t.tenantId, admin, t.course.id, { price: 1 }))).rejects.toMatchObject(blocked)
    await expect(inTenant(t.tenantId, () => manage().updateCourse(t.tenantId, teacher, t.course.id, { title: { uz: 'Y', ru: 'Y', en: 'Y' } }))).rejects.toMatchObject(blocked)
    await expect(inTenant(t.tenantId, () => manage().setCourseDiscount(t.tenantId, admin, t.course.id, { percent: 50, startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' }))).rejects.toMatchObject(blocked)
    await expect(inTenant(t.tenantId, () => manage().createGroup(t.tenantId, admin, t.course.id, { name: 'C', days: [1], start: '10:00', end: '11:00', room: '', capacity: 5 }))).rejects.toMatchObject(blocked)
    await expect(inTenant(t.tenantId, () => manage().updateGroup(t.tenantId, admin, t.group.id, { capacity: 50 }))).rejects.toMatchObject(blocked)
    await expect(inTenant(t.tenantId, () => manage().deleteGroup(t.tenantId, admin, t.group2.id))).rejects.toMatchObject(blocked)
    const course = await inTenant(t.tenantId, () => ctx.prisma.client.course.findFirstOrThrow({ where: { id: t.course.id } }))
    expect(course.priceMinor).toBe(50_000_00n)
    expect(course.discountPercent).toBeNull()
    // The Super Admin still can.
    await expect(inTenant(t.tenantId, () => manage().updateGroup(t.tenantId, owner, t.group.id, { capacity: 3 }))).resolves.toBeTruthy()

    const student = await ctx.makeStudent(t.tenantId)
    await expect(ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id])).rejects.toBeTruthy()
    const payments = await inTenant(t.tenantId, () => ctx.prisma.client.payment.count({ where: { tenantId: t.tenantId } }))
    expect(payments).toBe(0)
  })

  it('an approved center asks for a new name; it changes only when the Super Admin approves, and the audit keeps every field', async () => {
    const w = await world('ACTIVE')
    const answer = await inTenant(w.tenantId, () => centers().updateProfile(w.tenantId, w.admin, { name: 'Mashhur markaz', address: 'Toshkent' }))
    expect(answer).toMatchObject({ name: 'Yangi markaz', pendingName: 'Mashhur markaz', address: 'Toshkent' })
    let row = await inTenant(w.tenantId, () => ctx.prisma.client.center.findFirstOrThrow({ where: { id: w.center.id } }))
    expect(row.name).toBe('Yangi markaz')
    const audit = await inTenant(w.tenantId, () => ctx.prisma.client.auditEvent.findFirstOrThrow({ where: { tenantId: w.tenantId, action: 'center.profile', entityId: w.center.id } }))
    expect(audit.before).toMatchObject({ address: null, pendingName: null })
    expect(audit.after).toMatchObject({ address: 'Toshkent', pendingName: 'Mashhur markaz' })

    await inTenant(w.tenantId, () => manage().reviewCenterName(w.tenantId, owner, w.center.id, true))
    row = await inTenant(w.tenantId, () => ctx.prisma.client.center.findFirstOrThrow({ where: { id: w.center.id } }))
    expect(row.name).toBe('Mashhur markaz')
    expect(row.pendingName).toBeNull()

    // A center still waiting for approval renames itself directly: the approval looks at the name anyway.
    const pending = await world('PENDING')
    await expect(inTenant(pending.tenantId, () => centers().updateProfile(pending.tenantId, pending.admin, { name: 'Boshqa nom' }))).resolves.toMatchObject({ name: 'Boshqa nom', pendingName: null })
  })
})
