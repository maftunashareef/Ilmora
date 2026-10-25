import { Inject, Injectable } from '@nestjs/common'
import { attendanceUrl } from '@ilmora/shared'
import { randomToken, sha256 } from '../../common/crypto'
import { AppError } from '../../common/errors'
import { ENV, type Env } from '../../config/env'
import type { AttendanceStatus } from '../../generated/prisma/enums'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { type RequestActor, TenantContext } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { TenantsService } from '../tenants/tenants.service'
import { SessionsService } from '../sessions/sessions.service'
import { AttendanceEvents } from './attendance.events'

export type CheckInOutcome =
  | { ok: true; alreadyRecorded: boolean; record: RecordDto; session: ReturnType<typeof SessionsService.toDto> }
  | { ok: false; reason: 'invalid-link' | 'expired' | 'closed' | 'not-enrolled'; session?: ReturnType<typeof SessionsService.toDto> }

export interface RecordDto { id: string; sessionId: string; studentId: string; status: string; method: string; checkedInAt: string; reason?: string; correctedAt?: string }

const toRecord = (r: { id: string; sessionId: string; studentId: string; status: string; method: string; checkedInAt: Date; reason: string | null; correctedAt: Date | null }): RecordDto => ({
  id: r.id, sessionId: r.sessionId, studentId: r.studentId, status: r.status.toLowerCase(), method: r.method.toLowerCase(), checkedInAt: r.checkedInAt.toISOString(), reason: r.reason ?? undefined, correctedAt: r.correctedAt?.toISOString(),
})

/**
 * Attendance: per-session tokens (hashed at rest, rotated on open, void on close), validated check-ins,
 * teacher corrections with mandatory reasons, and live updates published through Redis.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: AttendanceEvents,
    private readonly tenants: TenantsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────── teacher side ─────────

  /** Session with ownership check: teachers manage sessions of their own courses; center admins their center; platform admins all. */
  async sessionForTeacher(sessionId: string, actor: RequestActor) {
    const session = await this.prisma.client.lessonSession.findFirst({ where: { id: sessionId }, include: { course: { select: { id: true, teacherId: true, centerId: true, title: true } }, group: true } })
    if (!session) throw AppError.notFound('Session')
    this.assertOwnership(session.course, actor)
    return session
  }

  private assertOwnership(course: { teacherId: string; centerId: string }, actor: RequestActor) {
    if (actor.roles.includes('PLATFORM_ADMIN')) return
    if (actor.roles.includes('CENTER_ADMIN') && actor.centerId === course.centerId) return
    if (actor.teacherProfileId && actor.teacherProfileId === course.teacherId) return
    throw AppError.forbidden('You do not manage this group')
  }

  async open(sessionId: string, actor: RequestActor) {
    const session = await this.sessionForTeacher(sessionId, actor)
    if (session.status === 'CANCELLED') throw AppError.invalid('session_cancelled', 'A cancelled session cannot take attendance')
    const token = randomToken(24)
    const expiresAt = new Date(Math.max(session.endsAt.getTime() + this.env.ATTENDANCE_TOKEN_GRACE_MINUTES * 60_000, Date.now() + 2 * 3_600_000))
    const updated = await this.prisma.client.lessonSession.update({
      where: { id: session.id },
      data: { attendanceOpen: true, attendanceOpenedAt: new Date(), attendanceClosedAt: null, attendanceTokenHash: sha256(token), attendanceTokenExpiresAt: expiresAt, tokenVersion: { increment: 1 } },
    })
    await this.audit.record({ action: 'attendance.open', entityType: 'LessonSession', entityId: session.id, after: { tokenVersion: updated.tokenVersion, expiresAt } })
    await this.events.publish(session.id, { type: 'session', session: SessionsService.toDto(updated) })
    return { session: SessionsService.toDto(updated), ...(await this.qrPayload(updated.id, token)) }
  }

  async close(sessionId: string, actor: RequestActor) {
    const session = await this.sessionForTeacher(sessionId, actor)
    const updated = await this.prisma.client.lessonSession.update({
      where: { id: session.id },
      data: { attendanceOpen: false, attendanceClosedAt: new Date(), attendanceTokenHash: null, attendanceTokenExpiresAt: null },
    })
    await this.audit.record({ action: 'attendance.close', entityType: 'LessonSession', entityId: session.id })
    await this.events.publish(session.id, { type: 'session', session: SessionsService.toDto(updated) })
    return { session: SessionsService.toDto(updated) }
  }

  /** The QR content is the check-in URL on the tenant's web origin. Only available while attendance is open and unexpired. */
  async qr(sessionId: string, actor: RequestActor) {
    const session = await this.sessionForTeacher(sessionId, actor)
    if (!session.attendanceOpen) throw AppError.invalid('attendance_closed', 'Open attendance to show the QR code')
    if (session.attendanceTokenExpiresAt && session.attendanceTokenExpiresAt < new Date()) {
      await this.prisma.client.lessonSession.update({
        where: { id: session.id },
        data: { attendanceOpen: false, attendanceClosedAt: new Date(), attendanceTokenHash: null, attendanceTokenExpiresAt: null },
      })
      throw AppError.invalid('attendance_expired', 'Attendance session has expired')
    }
    // A fresh token is issued on every QR request; the previous one stops working (rotation keeps screenshots short-lived).
    const token = randomToken(24)
    const updated = await this.prisma.client.lessonSession.update({ where: { id: session.id }, data: { attendanceTokenHash: sha256(token), tokenVersion: { increment: 1 } } })
    await this.audit.record({ action: 'attendance.rotate_token', entityType: 'LessonSession', entityId: session.id, after: { tokenVersion: updated.tokenVersion } })
    return { session: SessionsService.toDto(updated), ...(await this.qrPayload(session.id, token)) }
  }

  private async qrPayload(sessionId: string, token: string) {
    const tenant = await this.tenants.byTenantId(TenantContext.requireTenantId())
    const url = attendanceUrl({ id: sessionId, token }, tenant?.webOrigin ?? this.env.PUBLIC_WEB_URL)
    return { token, url }
  }

  async sessionDetail(sessionId: string, actor: RequestActor) {
    const session = await this.sessionForTeacher(sessionId, actor)
    const [records, roster] = await Promise.all([
      this.prisma.client.attendanceRecord.findMany({ where: { sessionId: session.id }, orderBy: { checkedInAt: 'asc' } }),
      this.prisma.client.enrollment.findMany({ where: { groupId: session.groupId, status: 'ACTIVE' }, include: { student: { select: { id: true, displayName: true, district: true } } } }),
    ])
    return {
      session: SessionsService.toDto(session),
      course: { id: session.course.id, title: session.course.title },
      group: { id: session.group.id, name: session.group.name, room: session.group.room, capacity: session.group.capacity },
      roster: roster.map((e) => ({ id: e.student.id, displayName: e.student.displayName, district: e.student.district })),
      records: records.map(toRecord),
    }
  }

  async setStatus(sessionId: string, status: 'scheduled' | 'cancelled' | 'completed', actor: RequestActor, reason?: string) {
    const session = await this.sessionForTeacher(sessionId, actor)
    const next = status.toUpperCase() as 'SCHEDULED' | 'CANCELLED' | 'COMPLETED'
    const updated = await this.prisma.client.lessonSession.update({
      where: { id: session.id },
      data: {
        status: next,
        ...(next === 'CANCELLED'
          ? { attendanceOpen: false, attendanceClosedAt: new Date(), attendanceTokenHash: null, attendanceTokenExpiresAt: null, cancelledAt: new Date(), cancelledById: actor.id }
          : { cancelledAt: null, cancelledById: null }),
      },
    })
    await this.audit.record({ action: 'session.status', entityType: 'LessonSession', entityId: session.id, before: { status: session.status }, after: { status: next }, reason })
    await this.events.publish(session.id, { type: 'session', session: SessionsService.toDto(updated) })
    return { session: SessionsService.toDto(updated) }
  }

  /** Teacher correction: creates or updates a record with a reason; the original check-in time is never overwritten. */
  async correct(sessionId: string, actor: RequestActor, input: { studentId: string; status: AttendanceStatus; reason: string }) {
    const session = await this.sessionForTeacher(sessionId, actor)
    const enrolled = await this.prisma.client.enrollment.findFirst({ where: { groupId: session.groupId, studentId: input.studentId, status: { in: ['ACTIVE', 'COMPLETED'] } } })
    if (!enrolled) throw AppError.invalid('not_enrolled', 'This student is not enrolled in the group')
    const before = await this.prisma.client.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: input.studentId } } })
    const now = new Date()
    const record = before
      ? await this.prisma.client.attendanceRecord.update({
          where: { id: before.id },
          data: { status: input.status, reason: input.reason, correctedAt: now, correctedById: actor.id, version: { increment: 1 } },
        })
      : await this.prisma.client.attendanceRecord.create({
          data: { tenantId: session.tenantId, sessionId: session.id, studentId: input.studentId, status: input.status, method: 'MANUAL', checkedInAt: now, recordedById: actor.id, reason: input.reason },
        })
    await this.audit.record({
      action: before ? 'attendance.correct' : 'attendance.manual',
      entityType: 'AttendanceRecord',
      entityId: record.id,
      before: before ? { status: before.status, reason: before.reason } : undefined,
      after: { status: record.status, reason: record.reason },
      reason: input.reason,
    })
    const dto = toRecord(record)
    await this.events.publish(session.id, { type: 'record', record: dto })
    return dto
  }

  // ───────── student side ─────────

  /** Authenticated check-in. Mutation only through this POST; link previews cannot trigger it. */
  async checkIn(studentId: string, input: { sessionId: string; token: string }, meta: { ip?: string; userAgent?: string }): Promise<CheckInOutcome> {
    const session = await this.prisma.client.lessonSession.findFirst({ where: { id: input.sessionId } })
    if (!session || !input.token) return { ok: false, reason: 'invalid-link' }
    const dto = SessionsService.toDto(session)
    const enrolled = await this.prisma.client.enrollment.findFirst({ where: { groupId: session.groupId, studentId, status: 'ACTIVE' } })
    if (!enrolled) return { ok: false, reason: 'not-enrolled', session: dto }
    // A student who is already recorded gets the same answer on every repeat scan, even after the
    // teacher's QR rotated; a new record still requires the session's current, unexpired token.
    const existing = await this.prisma.client.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId } } })
    if (existing) return { ok: true, alreadyRecorded: true, record: toRecord(existing), session: dto }
    if (!session.attendanceTokenHash || session.attendanceTokenHash !== sha256(input.token)) return { ok: false, reason: 'invalid-link', session: dto }
    if (session.attendanceTokenExpiresAt && session.attendanceTokenExpiresAt < new Date()) return { ok: false, reason: 'expired', session: dto }
    if (!session.attendanceOpen || session.status === 'CANCELLED') return { ok: false, reason: 'closed', session: dto }
    try {
      const record = await this.prisma.client.attendanceRecord.create({
        data: { tenantId: session.tenantId, sessionId: session.id, studentId, status: 'PRESENT', method: 'QR', checkedInAt: new Date(), recordedById: studentId, tokenVersion: session.tokenVersion, ip: meta.ip, userAgent: meta.userAgent },
      })
      await this.audit.record({ action: 'attendance.check_in', entityType: 'AttendanceRecord', entityId: record.id, after: { sessionId: session.id, method: 'QR' } })
      const out = toRecord(record)
      await this.events.publish(session.id, { type: 'record', record: out })
      return { ok: true, alreadyRecorded: false, record: out, session: dto }
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        const race = await this.prisma.client.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId } } })
        if (race) return { ok: true, alreadyRecorded: true, record: toRecord(race), session: dto }
      }
      throw err
    }
  }

  /** Public (unauthenticated) look-up so the check-in page can show which lesson the link belongs to. */
  async describeLink(sessionId: string) {
    const session = await this.prisma.client.lessonSession.findFirst({ where: { id: sessionId }, include: { course: { select: { title: true } }, group: { select: { name: true, timezone: true } } } })
    if (!session) return null
    return { session: SessionsService.toDto(session), courseTitle: session.course.title, groupName: session.group.name }
  }

  async myAttendance(studentId: string) {
    const enrollments = await this.prisma.client.enrollment.findMany({ where: { studentId, status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { groupId: true } })
    const groupIds = enrollments.map((e) => e.groupId)
    const [sessions, records] = await Promise.all([
      this.prisma.client.lessonSession.findMany({ where: { groupId: { in: groupIds } }, orderBy: { startsAt: 'asc' } }),
      this.prisma.client.attendanceRecord.findMany({ where: { studentId }, orderBy: { checkedInAt: 'desc' } }),
    ])
    return { sessions: sessions.map(SessionsService.toDto), records: records.map(toRecord) }
  }
}
