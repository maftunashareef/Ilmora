import { Injectable } from '@nestjs/common'
import { normalizeUzPhone, subscriptionAccess } from '@ilmora/shared'
import { randomToken } from '../../common/crypto'
import { AppError } from '../../common/errors'
import { isoToDateColumn, localDate } from '../../common/time'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AttendanceService } from '../attendance/attendance.service'
import { AuditService } from '../audit/audit.service'
import { toTeacher } from '../catalog/catalog.service'
import type { CenterProfileInput, CenterTeacherInput, CenterTeacherPatch } from '../manage/manage.schemas'
import { NotificationsService } from '../notifications/notifications.service'
import { SessionsService } from '../sessions/sessions.service'

type Json = Prisma.InputJsonValue
const DEFAULT_TZ = 'Asia/Tashkent'

/**
 * The Educational Center workspace: everything is scoped to the administrator's own center (`actor.centerId`).
 * Courses and groups are delegated to ManageService, which already restricts center admins to their center.
 */
@Injectable()
export class CenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The administrator's center (never another one). */
  async own(tenantId: string, actor: RequestActor) {
    if (!actor.centerId) throw AppError.forbidden('Your account is not linked to a center', { code: 'center_required' })
    const center = await this.prisma.client.center.findFirst({ where: { tenantId, id: actor.centerId } })
    if (!center) throw AppError.notFound('Center')
    return center
  }

  /** Writes are refused while the center is blocked or rejected (reads still work so the administrator sees why). */
  private assertWritable(center: { status: string }) {
    if (center.status === 'BLOCKED' || center.status === 'REJECTED') throw AppError.forbidden('This center is blocked', { code: 'center_blocked' })
  }

  private profile(c: { id: string; slug: string; name: string; district: unknown; description: unknown; tone: string; address: string | null; phoneE164: string | null; status: string; approvedAt: Date | null; blockedAt: Date | null; blockReason: string | null; lat: number | null; lng: number | null; geoRadiusM: number | null; checkInBeforeMin: number; absenceAfterMin: number; createdAt: Date }) {
    return {
      id: c.id, slug: c.slug, name: c.name, district: c.district, description: c.description, tone: c.tone, address: c.address, phone: c.phoneE164,
      status: c.status, approvedAt: c.approvedAt, blockedAt: c.blockedAt, blockReason: c.blockReason, createdAt: c.createdAt,
      checkIn: { lat: c.lat, lng: c.lng, geoRadiusM: c.geoRadiusM, checkInBeforeMin: c.checkInBeforeMin, absenceAfterMin: c.absenceAfterMin },
    }
  }

  async overview(tenantId: string, actor: RequestActor) {
    const center = await this.own(tenantId, actor)
    const today = localDate(new Date(), DEFAULT_TZ)
    const [teachers, courses, groups, students, sessions] = await Promise.all([
      this.prisma.client.teacherProfile.count({ where: { tenantId, centerId: center.id } }),
      this.prisma.client.course.count({ where: { tenantId, centerId: center.id } }),
      this.prisma.client.group.count({ where: { tenantId, course: { centerId: center.id } } }),
      this.prisma.client.enrollment.findMany({ where: { tenantId, status: 'ACTIVE', course: { centerId: center.id } }, select: { studentId: true }, distinct: ['studentId'] }),
      this.todaySessions(tenantId, center.id, today),
    ])
    return { center: this.profile(center), counts: { teachers, courses, groups, students: students.length }, today: sessions }
  }

  /** Today's lessons at the center with roster, check-in and absence counts (for the overview and the attendance page). */
  private async todaySessions(tenantId: string, centerId: string, date: string) {
    const rows = await this.prisma.client.lessonSession.findMany({
      where: { tenantId, date: isoToDateColumn(date), course: { centerId } },
      include: { course: { select: { id: true, title: true, teacherId: true, teacher: { select: { name: true } } } }, group: { select: { id: true, name: true, room: true, timezone: true } }, attendance: { select: { status: true } } },
      orderBy: { startsAt: 'asc' },
    })
    const groupIds = [...new Set(rows.map((r) => r.groupId))]
    const roster = groupIds.length ? await this.prisma.client.enrollment.groupBy({ by: ['groupId'], where: { tenantId, groupId: { in: groupIds }, status: 'ACTIVE' }, _count: { _all: true } }) : []
    const size = new Map(roster.map((r) => [r.groupId, r._count._all]))
    return rows.map((s) => ({
      session: SessionsService.toDto(s),
      courseTitle: s.course.title,
      courseId: s.course.id,
      teacherName: s.course.teacher.name,
      group: { id: s.group.id, name: s.group.name, room: s.group.room },
      roster: size.get(s.groupId) ?? 0,
      present: s.attendance.filter((a) => a.status === 'PRESENT').length,
      absent: s.attendance.filter((a) => a.status === 'ABSENT').length,
    }))
  }

  async attendanceDay(tenantId: string, actor: RequestActor, date?: string) {
    const center = await this.own(tenantId, actor)
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDate(new Date(), DEFAULT_TZ)
    return { date: day, sessions: await this.todaySessions(tenantId, center.id, day) }
  }

  async updateProfile(tenantId: string, actor: RequestActor, input: CenterProfileInput) {
    const center = await this.own(tenantId, actor)
    this.assertWritable(center)
    const data: Record<string, unknown> = {}
    for (const k of ['name', 'tone', 'address', 'lat', 'lng', 'geoRadiusM', 'checkInBeforeMin', 'absenceAfterMin'] as const) if (input[k] !== undefined) data[k] = input[k]
    for (const k of ['district', 'description'] as const) if (input[k] !== undefined) data[k] = input[k] as Json
    if (input.phone !== undefined) {
      if (input.phone === null || input.phone === '') data.phoneE164 = null
      else {
        const phone = normalizeUzPhone(input.phone)
        if (!phone.ok) throw AppError.invalid('invalid_phone', 'Invalid phone number')
        data.phoneE164 = phone.e164
      }
    }
    // A location check needs all three values; clearing one clears the check.
    const lat = input.lat !== undefined ? input.lat : center.lat
    const lng = input.lng !== undefined ? input.lng : center.lng
    const radius = input.geoRadiusM !== undefined ? input.geoRadiusM : center.geoRadiusM
    if ((lat == null || lng == null || radius == null) && (input.lat !== undefined || input.lng !== undefined || input.geoRadiusM !== undefined)) Object.assign(data, { lat: lat ?? null, lng: lng ?? null, geoRadiusM: lat != null && lng != null ? radius : null })
    const updated = await this.prisma.client.center.update({ where: { id: center.id }, data: data as Prisma.CenterUncheckedUpdateInput })
    await this.audit.record({ action: 'center.profile', entityType: 'Center', entityId: center.id, before: { checkInBeforeMin: center.checkInBeforeMin, absenceAfterMin: center.absenceAfterMin, geoRadiusM: center.geoRadiusM }, after: { checkInBeforeMin: updated.checkInBeforeMin, absenceAfterMin: updated.absenceAfterMin, geoRadiusM: updated.geoRadiusM } })
    return this.profile(updated)
  }

  /** The center's standing QR code (created on first use). */
  async qr(tenantId: string, actor: RequestActor) {
    let center = await this.own(tenantId, actor)
    if (!center.checkInCode) center = await this.prisma.client.center.update({ where: { id: center.id }, data: { checkInCode: randomToken(16), checkInCodeRotatedAt: new Date() } })
    return { code: center.checkInCode!, url: await this.attendance.centerQrUrl(center.checkInCode!), rotatedAt: center.checkInCodeRotatedAt }
  }

  /** New code: printed copies of the old one stop working immediately. */
  async rotateQr(tenantId: string, actor: RequestActor) {
    const center = await this.own(tenantId, actor)
    this.assertWritable(center)
    const updated = await this.prisma.client.center.update({ where: { id: center.id }, data: { checkInCode: randomToken(16), checkInCodeRotatedAt: new Date() } })
    await this.audit.record({ action: 'center.qr_rotate', entityType: 'Center', entityId: center.id })
    return { code: updated.checkInCode!, url: await this.attendance.centerQrUrl(updated.checkInCode!), rotatedAt: updated.checkInCodeRotatedAt }
  }

  // ───────── teachers ─────────

  async teachers(tenantId: string, actor: RequestActor) {
    const center = await this.own(tenantId, actor)
    const rows = await this.prisma.client.teacherProfile.findMany({
      where: { tenantId, centerId: center.id },
      include: { user: { select: { id: true, login: true, isActive: true } }, _count: { select: { courses: true } } },
      orderBy: { name: 'asc' },
    })
    return rows.map((t) => ({ ...toTeacher(t), account: t.user ? { id: t.user.id, login: t.user.login, isActive: t.user.isActive } : null, courses: t._count.courses }))
  }

  /**
   * Adds a teacher. With `login`, the registered teacher account is linked: its profile joins the center (a profile that
   * already belongs to another center is refused). Without a login, a profile is created to be linked later.
   */
  async addTeacher(tenantId: string, actor: RequestActor, input: CenterTeacherInput) {
    const center = await this.own(tenantId, actor)
    this.assertWritable(center)
    const base = { name: input.name, title: (input.title ?? {}) as Json, bio: (input.bio ?? {}) as Json, tagline: (input.tagline ?? {}) as Json, expertise: input.expertise ?? [], avatarUrl: input.avatarUrl ?? null }
    if (input.login) {
      const login = input.login.normalize('NFKC').trim().toLowerCase()
      const user = await this.prisma.client.user.findUnique({ where: { tenantId_login: { tenantId, login } }, include: { teacherProfile: true } })
      if (!user || !user.roles.includes('TEACHER')) throw AppError.notFound('Teacher account', { code: 'teacher_login_not_found' })
      if (!user.isActive) throw AppError.invalid('account_disabled', 'This account is disabled')
      if (user.teacherProfile?.centerId && user.teacherProfile.centerId !== center.id) throw AppError.conflict('teacher_elsewhere', 'This teacher already belongs to another center')
      const profile = user.teacherProfile
        ? await this.prisma.client.teacherProfile.update({ where: { id: user.teacherProfile.id }, data: { centerId: center.id, ...(input.title ? { title: input.title as Json } : {}), ...(input.expertise ? { expertise: input.expertise } : {}) } })
        : await this.prisma.client.teacherProfile.create({ data: { tenantId, userId: user.id, centerId: center.id, slug: await this.freeSlug(tenantId, login), ...base } })
      await this.prisma.client.user.update({ where: { id: user.id }, data: { centerId: user.centerId ?? center.id } })
      await this.audit.record({ action: 'center.teacher_link', entityType: 'TeacherProfile', entityId: profile.id, after: { centerId: center.id, userId: user.id } })
      await this.notifications.safely('center.teacherLinked', () => this.notifications.notify({ tenantId, userIds: [user.id], type: 'center.teacherLinked', params: { centerName: center.name, centerId: center.id }, dedupeKey: `teacher-linked:${profile.id}:${center.id}` }))
      return toTeacher(profile)
    }
    const profile = await this.prisma.client.teacherProfile.create({ data: { tenantId, centerId: center.id, slug: await this.freeSlug(tenantId, input.name), ...base } })
    await this.audit.record({ action: 'center.teacher_create', entityType: 'TeacherProfile', entityId: profile.id, after: { centerId: center.id } })
    return toTeacher(profile)
  }

  async updateTeacher(tenantId: string, actor: RequestActor, id: string, input: CenterTeacherPatch) {
    const center = await this.own(tenantId, actor)
    this.assertWritable(center)
    const existing = await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, id, centerId: center.id } })
    if (!existing) throw AppError.notFound('Teacher')
    const data: Record<string, unknown> = {}
    for (const k of ['name', 'expertise', 'avatarUrl'] as const) if (input[k] !== undefined) data[k] = input[k]
    for (const k of ['title', 'bio', 'tagline'] as const) if (input[k] !== undefined) data[k] = input[k] as Json
    const updated = await this.prisma.client.teacherProfile.update({ where: { id }, data: data as Prisma.TeacherProfileUncheckedUpdateInput })
    if (input.name && existing.userId) await this.prisma.client.user.update({ where: { id: existing.userId }, data: { displayName: input.name } }).catch(() => undefined)
    return toTeacher(updated)
  }

  /** Detaches a teacher from the center (the profile and account stay); refused while the teacher still has courses here. */
  async removeTeacher(tenantId: string, actor: RequestActor, id: string) {
    const center = await this.own(tenantId, actor)
    this.assertWritable(center)
    const existing = await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, id, centerId: center.id } })
    if (!existing) throw AppError.notFound('Teacher')
    const courses = await this.prisma.client.course.count({ where: { tenantId, teacherId: id, centerId: center.id } })
    if (courses > 0) throw AppError.conflict('in_use', 'Reassign or archive the teacher’s courses first')
    await this.prisma.client.teacherProfile.update({ where: { id }, data: { centerId: null } })
    if (existing.userId) {
      const user = await this.prisma.client.user.findFirst({ where: { id: existing.userId }, select: { centerId: true, roles: true } })
      if (user?.centerId === center.id && !user.roles.includes('CENTER_ADMIN')) await this.prisma.client.user.update({ where: { id: existing.userId }, data: { centerId: null } })
    }
    await this.audit.record({ action: 'center.teacher_unlink', entityType: 'TeacherProfile', entityId: id, before: { centerId: center.id } })
    return { ok: true }
  }

  // ───────── students ─────────

  /** Students enrolled in the center's groups with their subscription state and attendance totals at this center. */
  async students(tenantId: string, actor: RequestActor) {
    const center = await this.own(tenantId, actor)
    const enrollments = await this.prisma.client.enrollment.findMany({
      where: { tenantId, status: 'ACTIVE', course: { centerId: center.id } },
      include: { student: { select: { id: true, displayName: true, district: true, phoneE164: true, isActive: true } }, group: { select: { id: true, name: true } }, course: { select: { id: true, title: true } }, subscription: { select: { status: true, kind: true, currentPeriodEnd: true, lessonsTotal: true, lessonsUsed: true, graceEndsAt: true, blockReason: true } } },
      orderBy: { enrolledAt: 'asc' },
    })
    const studentIds = [...new Set(enrollments.map((e) => e.studentId))]
    const records = studentIds.length
      ? await this.prisma.client.attendanceRecord.groupBy({ by: ['studentId', 'status'], where: { tenantId, studentId: { in: studentIds }, session: { course: { centerId: center.id } } }, _count: { _all: true } })
      : []
    const totals = new Map<string, { present: number; absent: number; excused: number }>()
    for (const r of records) {
      const t = totals.get(r.studentId) ?? { present: 0, absent: 0, excused: 0 }
      if (r.status === 'PRESENT') t.present += r._count._all
      else if (r.status === 'ABSENT') t.absent += r._count._all
      else t.excused += r._count._all
      totals.set(r.studentId, t)
    }
    const byStudent = new Map<string, { id: string; displayName: string; district: string | null; phoneMasked: string | null; isActive: boolean; groups: { id: string; name: string; courseId: string; courseTitle: unknown }[]; subscription: ReturnType<typeof subscriptionAccess> & { status: string; kind: string } | null; attendance: { present: number; absent: number; excused: number } }>()
    for (const e of enrollments) {
      const cur = byStudent.get(e.studentId) ?? {
        id: e.student.id, displayName: e.student.displayName, district: e.student.district, phoneMasked: e.student.phoneE164 ? e.student.phoneE164.replace(/(\+998\d{2})\d{5}(\d{2})/, '$1*****$2') : null, isActive: e.student.isActive,
        groups: [], subscription: { ...subscriptionAccess(e.subscription), status: e.subscription.status, kind: e.subscription.kind }, attendance: totals.get(e.studentId) ?? { present: 0, absent: 0, excused: 0 },
      }
      cur.groups.push({ id: e.group.id, name: e.group.name, courseId: e.course.id, courseTitle: e.course.title })
      byStudent.set(e.studentId, cur)
    }
    return [...byStudent.values()]
  }

  private async freeSlug(tenantId: string, base: string): Promise<string> {
    const root = base.toLowerCase().replace(/ş/g, 'sh').replace(/ç/g, 'ch').replace(/ö/g, 'o').replace(/ğ/g, 'g').normalize('NFKD').replace(/[‘’'`ʻ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'teacher'
    for (let n = 0; n < 50; n++) {
      const slug = n === 0 ? root : `${root}-${n + 1}`
      if (!(await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, slug }, select: { id: true }, includeDeleted: true } as never))) return slug
    }
    return `${root}-${Date.now().toString(36)}`
  }
}
