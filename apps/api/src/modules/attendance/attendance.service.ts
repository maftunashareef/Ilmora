import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { attendanceUrl, checkInWindow, checkLocation, requiresLocation, type CenterCheckInFailure, type CheckInWindowState } from '@ilmora/shared'
import { randomToken, sha256 } from '../../common/crypto'
import { AppError } from '../../common/errors'
import { dateColumnToIso, isoToDateColumn, localDate, localTime, zonedTimeToUtc } from '../../common/time'
import { ENV, type Env } from '../../config/env'
import type { AttendanceStatus } from '../../generated/prisma/enums'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { type RequestActor, TenantContext } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { SubscriptionService } from '../enrollment/subscription.service'
import { NotificationsService } from '../notifications/notifications.service'
import { TenantsService } from '../tenants/tenants.service'
import { SessionsService } from '../sessions/sessions.service'
import { AttendanceEvents } from './attendance.events'

export type CheckInOutcome =
  | { ok: true; alreadyRecorded: boolean; record: RecordDto; session: ReturnType<typeof SessionsService.toDto> }
  | { ok: false; reason: 'invalid-link' | 'expired' | 'closed' | 'not-enrolled' | 'blocked'; session?: ReturnType<typeof SessionsService.toDto> }

export type CenterCheckInOutcome =
  | { ok: true; alreadyRecorded: boolean; record: RecordDto; session: ReturnType<typeof SessionsService.toDto> }
  | { ok: false; reason: CenterCheckInFailure; session?: ReturnType<typeof SessionsService.toDto>; window?: { state: CheckInWindowState; opensAt: string; closesAt: string }; distanceM?: number | null }

export interface RecordDto { id: string; sessionId: string; studentId: string; status: string; method: string; checkedInAt: string; reason?: string; correctedAt?: string }

export interface GeoInput { lat?: number; lng?: number; accuracyM?: number }

const toRecord = (r: { id: string; sessionId: string; studentId: string; status: string; method: string; checkedInAt: Date; reason: string | null; correctedAt: Date | null }): RecordDto => ({
  id: r.id, sessionId: r.sessionId, studentId: r.studentId, status: r.status.toLowerCase(), method: r.method.toLowerCase(), checkedInAt: r.checkedInAt.toISOString(), reason: r.reason ?? undefined, correctedAt: r.correctedAt?.toISOString(),
})

const CENTER_SELECT = { id: true, name: true, status: true, address: true, lat: true, lng: true, geoRadiusM: true, checkInBeforeMin: true, absenceAfterMin: true } as const
const SESSION_INCLUDE = { course: { select: { id: true, title: true, teacherId: true, centerId: true } }, group: { select: { id: true, name: true, timezone: true, days: true, room: true, capacity: true } } } as const
/** A lesson row with its course and group, as every check-in path loads it. */
type SessionRow = { id: string; tenantId: string; groupId: string; courseId: string; date: Date; startsAt: Date; endsAt: Date; status: string; attendanceOpen: boolean; attendanceOpenedAt: Date | null; attendanceClosedAt: Date | null; tokenVersion: number; isExtra?: boolean; note?: string | null; rescheduledFromId?: string | null; course: { id: string; title: unknown; teacherId: string; centerId: string }; group: { id: string; name: string; timezone: string } }
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Attendance: per-lesson tokens (hashed at rest, rotated on open, void on close), the center's standing QR code with a
 * time window and an optional location check, automatic absences, corrections with mandatory reasons, lesson
 * consumption for lesson-based subscriptions, and live updates published through Redis.
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: AttendanceEvents,
    private readonly tenants: TenantsService,
    private readonly subscriptions: SubscriptionService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────── teacher side ─────────

  /** Session with ownership check: teachers manage sessions of their own courses; center admins their center; platform admins all. */
  async sessionForTeacher(sessionId: string, actor: RequestActor) {
    const session = await this.prisma.client.lessonSession.findFirst({ where: { id: sessionId }, include: SESSION_INCLUDE })
    if (!session) throw AppError.notFound('Session')
    this.assertOwnership(session.course, actor)
    return session
  }

  /** Same as sessionForTeacher, for changes: a blocked or rejected center no longer runs lessons (the Super Admin still can). */
  private async sessionForWrite(sessionId: string, actor: RequestActor) {
    const session = await this.sessionForTeacher(sessionId, actor)
    await this.assertCenterWritable(session.course.centerId, actor)
    return session
  }

  private async assertCenterWritable(centerId: string, actor: RequestActor) {
    if (actor.roles.includes('PLATFORM_ADMIN')) return
    const center = await this.prisma.client.center.findFirst({ where: { id: centerId }, select: { status: true } })
    if (center && (center.status === 'BLOCKED' || center.status === 'REJECTED')) throw AppError.forbidden('This center is blocked', { code: 'center_blocked' })
  }

  private assertOwnership(course: { teacherId: string; centerId: string }, actor: RequestActor) {
    if (actor.roles.includes('PLATFORM_ADMIN')) return
    if (actor.roles.includes('CENTER_ADMIN') && actor.centerId === course.centerId) return
    if (actor.teacherProfileId && actor.teacherProfileId === course.teacherId) return
    throw AppError.forbidden('You do not manage this group')
  }

  async open(sessionId: string, actor: RequestActor) {
    const session = await this.sessionForWrite(sessionId, actor)
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
    const session = await this.sessionForWrite(sessionId, actor)
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

  private async webOrigin(): Promise<string> {
    const tenant = await this.tenants.byTenantId(TenantContext.requireTenantId())
    return tenant?.webOrigin ?? this.env.PUBLIC_WEB_URL
  }

  private async qrPayload(sessionId: string, token: string) {
    const url = attendanceUrl({ id: sessionId, token }, await this.webOrigin())
    return { token, url }
  }

  /** Link inside the center's standing QR code. */
  async centerQrUrl(code: string): Promise<string> {
    return `${(await this.webOrigin()).replace(/\/$/, '')}/attend/c/${encodeURIComponent(code)}`
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
    const session = await this.sessionForWrite(sessionId, actor)
    const next = status.toUpperCase() as 'SCHEDULED' | 'CANCELLED' | 'COMPLETED'
    const data = {
      status: next,
      ...(next === 'CANCELLED'
        ? { attendanceOpen: false, attendanceClosedAt: new Date(), attendanceTokenHash: null, attendanceTokenExpiresAt: null, cancelledAt: new Date(), cancelledById: actor.id, ...(reason ? { note: reason } : {}) }
        : { cancelledAt: null, cancelledById: null }),
    }
    // The change of status and the lessons it moves happen together, and only from the status that was read: two
    // presses at once (cancel twice, restore twice) move the lessons once.
    const changed = await this.prisma.tx(async (tx) => {
      const claimed = await tx.lessonSession.updateMany({ where: { id: session.id, status: session.status }, data })
      if (claimed.count !== 1) return false
      if (next === 'CANCELLED' && session.status !== 'CANCELLED') {
        // Lessons used by check-ins on a lesson that is now cancelled go back to lesson-based subscriptions.
        const counted = await tx.attendanceRecord.findMany({ where: { sessionId: session.id, lessonCounted: true }, select: { id: true, studentId: true } })
        for (const r of counted) await this.subscriptions.releaseLesson(tx, session.tenantId, r.studentId, r.id)
      }
      if (session.status === 'CANCELLED' && next !== 'CANCELLED') {
        // The lesson is back: the check-ins kept on it take their lessons again — cancel and restore never give a lesson
        // away for free (security review 10.11 №40).
        const present = await tx.attendanceRecord.findMany({ where: { sessionId: session.id, status: 'PRESENT', lessonCounted: false }, select: { id: true, studentId: true } })
        for (const r of present) await this.subscriptions.consumeLesson(tx, session.tenantId, r.studentId, r.id)
      }
      return true
    })
    const updated = await this.prisma.client.lessonSession.findFirstOrThrow({ where: { id: session.id } })
    // Someone else changed the lesson a moment earlier: its current state is the answer, nothing is moved twice.
    if (!changed) return { session: SessionsService.toDto(updated) }
    await this.audit.record({ action: 'session.status', entityType: 'LessonSession', entityId: session.id, before: { status: session.status }, after: { status: next }, reason })
    await this.events.publish(session.id, { type: 'session', session: SessionsService.toDto(updated) })
    if (session.status !== next && (next === 'CANCELLED' || session.status === 'CANCELLED')) {
      await this.notifyGroup(session, next === 'CANCELLED' ? 'schedule.cancelled' : 'schedule.restored', { ...this.lessonParams(session), reason: reason ?? null }, `session-${next.toLowerCase()}:${session.id}:${Date.now()}`)
    }
    return { session: SessionsService.toDto(updated) }
  }

  /** Correction with a reason: creates or updates a record; the original check-in time is never overwritten; a QR check-in only by the Super Admin. */
  async correct(sessionId: string, actor: RequestActor, input: { studentId: string; status: AttendanceStatus; reason: string }) {
    const session = await this.sessionForWrite(sessionId, actor)
    if (session.status === 'CANCELLED') throw AppError.invalid('session_cancelled', 'A cancelled lesson has no attendance')
    const enrolled = await this.prisma.client.enrollment.findFirst({ where: { groupId: session.groupId, studentId: input.studentId, status: { in: ['ACTIVE', 'COMPLETED'] } } })
    if (!enrolled) throw AppError.invalid('not_enrolled', 'This student is not enrolled in the group')
    const before = await this.prisma.client.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: input.studentId } } })
    // A check-in by QR (the lesson's or the center's) is the student's own mark and lessons of a subscription depend on it:
    // the teacher and the center do not change it, a disputed one is corrected by the Super Admin (ТЗ 2026-11-18, 5;
    // Тимур, 20.11). Absences of the worker and the teacher's own marks are corrected as before.
    if (before && (before.method === 'QR' || before.method === 'CENTER_QR') && !actor.roles.includes('PLATFORM_ADMIN')) {
      throw new AppError('qr_read_only', 'A QR check-in is corrected by the Super Admin', HttpStatus.FORBIDDEN)
    }
    const now = new Date()
    const record = await this.prisma.tx(async (tx) => {
      const row = before
        ? await tx.attendanceRecord.update({
            where: { id: before.id },
            data: { status: input.status, reason: input.reason, correctedAt: now, correctedById: actor.id, version: { increment: 1 } },
          })
        : await tx.attendanceRecord.create({
            data: { tenantId: session.tenantId, sessionId: session.id, studentId: input.studentId, status: input.status, method: 'MANUAL', checkedInAt: now, recordedById: actor.id, reason: input.reason },
          })
      // Lesson-based subscriptions: a correction to PRESENT uses a lesson, a correction away from PRESENT gives it back.
      if (input.status === 'PRESENT') await this.subscriptions.consumeLesson(tx, session.tenantId, input.studentId, row.id)
      else await this.subscriptions.releaseLesson(tx, session.tenantId, input.studentId, row.id)
      return row
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

  // ───────── student side: per-lesson QR shown by the teacher ─────────

  /** Authenticated check-in. Mutation only through this POST; link previews cannot trigger it. */
  async checkIn(studentId: string, input: { sessionId: string; token: string }, meta: { ip?: string; userAgent?: string }): Promise<CheckInOutcome> {
    const session = await this.prisma.client.lessonSession.findFirst({ where: { id: input.sessionId }, include: SESSION_INCLUDE })
    if (!session || !input.token) return { ok: false, reason: 'invalid-link' }
    const dto = SessionsService.toDto(session)
    const enrolled = await this.prisma.client.enrollment.findFirst({ where: { groupId: session.groupId, studentId, status: 'ACTIVE' } })
    if (!enrolled) return { ok: false, reason: 'not-enrolled', session: dto }
    // A student who is already recorded gets the same answer on every repeat scan, even after the
    // teacher's QR rotated; a new record still requires the session's current, unexpired token.
    const existing = await this.prisma.client.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId } } })
    if (existing && existing.method !== 'AUTO') return { ok: true, alreadyRecorded: true, record: toRecord(existing), session: dto }
    // Closing or cancelling a lesson clears its QR: a student of the group scanning it then learns the lesson is closed,
    // not that the link is wrong (Н16). Outsiders were turned away above.
    if (!session.attendanceOpen || session.status === 'CANCELLED') return { ok: false, reason: 'closed', session: dto }
    if (!session.attendanceTokenHash || session.attendanceTokenHash !== sha256(input.token)) return { ok: false, reason: 'invalid-link', session: dto }
    if (session.attendanceTokenExpiresAt && session.attendanceTokenExpiresAt < new Date()) return { ok: false, reason: 'expired', session: dto }
    if ((await this.subscriptions.accessFor(studentId)).blocked) return { ok: false, reason: 'blocked', session: dto }
    return existing ? this.promoteAutoAbsence(session, existing, studentId, 'QR', meta) : this.recordPresence(session, studentId, 'QR', meta)
  }

  // ───────── student side: the center's standing QR code ─────────

  private centerByCode(code: string) {
    return code ? this.prisma.client.center.findFirst({ where: { checkInCode: code }, select: CENTER_SELECT }) : Promise.resolve(null)
  }

  /** Public look-up of a scanned center code: enough to show the student which center it is, nothing personal. */
  async describeCenterCode(code: string) {
    const center = await this.centerByCode(code)
    // An unknown or changed code (an old poster after «Сменить код») is 404, a blocked center 403 — never an empty 200
    // the page waits on forever (re-check 11.11 №86).
    if (!center) throw new AppError('center_code_invalid', 'This QR code is not valid any more: ask the center for its current one', HttpStatus.NOT_FOUND)
    if (center.status === 'BLOCKED' || center.status === 'REJECTED') throw new AppError('center_blocked', 'This center is blocked', HttpStatus.FORBIDDEN)
    return { center: { id: center.id, name: center.name, address: center.address }, requiresLocation: requiresLocation(center), window: { beforeMin: center.checkInBeforeMin, afterMin: center.absenceAfterMin } }
  }

  /** The signed-in student's lessons at this center today, each with its check-in window and any record. */
  async centerOptions(code: string, studentId: string, now = new Date()) {
    const center = await this.centerByCode(code)
    if (!center) throw AppError.notFound('Center')
    if (center.status === 'BLOCKED' || center.status === 'REJECTED') throw AppError.forbidden('This center is blocked', { code: 'center_blocked' })
    const [access, enrollments] = await Promise.all([this.subscriptions.accessFor(studentId), this.prisma.client.enrollment.findMany({ where: { studentId, status: 'ACTIVE', course: { centerId: center.id } }, select: { groupId: true } })])
    const groupIds = enrollments.map((e) => e.groupId)
    const today = localDate(now, this.env.SCHEDULE_TIMEZONE)
    const sessions = groupIds.length
      ? await this.prisma.client.lessonSession.findMany({ where: { groupId: { in: groupIds }, date: isoToDateColumn(today), status: { not: 'CANCELLED' } }, include: SESSION_INCLUDE, orderBy: { startsAt: 'asc' } })
      : []
    const records = sessions.length ? await this.prisma.client.attendanceRecord.findMany({ where: { studentId, sessionId: { in: sessions.map((s) => s.id) } } }) : []
    return {
      center: { id: center.id, name: center.name, address: center.address },
      requiresLocation: requiresLocation(center),
      access: { blocked: access.blocked, reason: access.reason },
      lessons: sessions.map((s) => {
        const w = checkInWindow({ startsAt: s.startsAt, beforeMin: center.checkInBeforeMin, afterMin: center.absenceAfterMin }, now)
        const record = records.find((r) => r.sessionId === s.id)
        return { session: SessionsService.toDto(s), courseTitle: s.course.title, groupName: s.group.name, window: { state: w.state, opensAt: w.opensAt.toISOString(), closesAt: w.closesAt.toISOString() }, record: record ? toRecord(record) : null }
      }),
    }
  }

  /**
   * Check-in with the center's standing code. Order of checks: code → center → lesson at this center → enrollment →
   * existing record (idempotent) → subscription not blocked → lesson not cancelled → time window → location.
   */
  async centerCheckIn(code: string, studentId: string, input: { sessionId: string } & GeoInput, meta: { ip?: string; userAgent?: string }, now = new Date()): Promise<CenterCheckInOutcome> {
    const center = await this.centerByCode(code)
    if (!center) return { ok: false, reason: 'invalid-code' }
    if (center.status === 'BLOCKED' || center.status === 'REJECTED') return { ok: false, reason: 'center-blocked' }
    const session = await this.prisma.client.lessonSession.findFirst({ where: { id: input.sessionId }, include: SESSION_INCLUDE })
    if (!session || session.course.centerId !== center.id) return { ok: false, reason: 'wrong-center' }
    const dto = SessionsService.toDto(session)
    const enrolled = await this.prisma.client.enrollment.findFirst({ where: { groupId: session.groupId, studentId, status: 'ACTIVE' } })
    if (!enrolled) return { ok: false, reason: 'not-enrolled', session: dto }
    const existing = await this.prisma.client.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId } } })
    if (existing && existing.status === 'PRESENT') return { ok: true, alreadyRecorded: true, record: toRecord(existing), session: dto }
    // A record written by staff (a correction, an excuse) is the teacher's word; only the worker's automatic absence yields to a scan.
    if (existing && existing.method !== 'AUTO') return { ok: true, alreadyRecorded: true, record: toRecord(existing), session: dto }
    if ((await this.subscriptions.accessFor(studentId)).blocked) return { ok: false, reason: 'blocked', session: dto }
    if (session.status === 'CANCELLED') return { ok: false, reason: 'cancelled', session: dto }
    const w = checkInWindow({ startsAt: session.startsAt, beforeMin: center.checkInBeforeMin, afterMin: center.absenceAfterMin }, now)
    const window = { state: w.state, opensAt: w.opensAt.toISOString(), closesAt: w.closesAt.toISOString() }
    if (w.state !== 'open') return { ok: false, reason: w.state, session: dto, window }
    const loc = checkLocation(center, typeof input.lat === 'number' && typeof input.lng === 'number' ? { lat: input.lat, lng: input.lng, accuracyM: input.accuracyM } : null)
    if (loc.result === 'location-required' || loc.result === 'too-far') return { ok: false, reason: loc.result, session: dto, window, distanceM: loc.distanceM == null ? null : Math.round(loc.distanceM) }
    // An AUTO absence already written for this lesson (window closed, then reopened by a settings change) becomes a presence.
    if (existing) return this.promoteAutoAbsence(session, existing, studentId, 'CENTER_QR', meta, { distanceM: loc.distanceM }, now)
    return this.recordPresence(session, studentId, 'CENTER_QR', meta, { distanceM: loc.distanceM })
  }

  /** The worker's automatic absence becomes a presence when the student scans after all; staff corrections never reach here. */
  private async promoteAutoAbsence(session: SessionRow, existing: { id: string; status: string; method: string }, studentId: string, method: 'QR' | 'CENTER_QR', meta: { ip?: string; userAgent?: string }, extra: { distanceM?: number | null } = {}, now = new Date()) {
    const dto = SessionsService.toDto(session)
    const row = await this.prisma.tx(async (tx) => {
      const updated = await tx.attendanceRecord.update({ where: { id: existing.id }, data: { status: 'PRESENT', method, checkedInAt: now, recordedById: studentId, correctedAt: null, correctedById: null, ip: meta.ip, userAgent: meta.userAgent, version: { increment: 1 } } })
      await this.subscriptions.consumeLesson(tx, session.tenantId, studentId, updated.id)
      return updated
    })
    await this.audit.record({ action: 'attendance.check_in', entityType: 'AttendanceRecord', entityId: row.id, before: { status: existing.status, method: existing.method }, after: { sessionId: session.id, method, distanceM: extra.distanceM ?? undefined } })
    const out = toRecord(row)
    await this.events.publish(session.id, { type: 'record', record: out })
    await this.notifyCheckIn(session, studentId, out)
    return { ok: true as const, alreadyRecorded: false, record: out, session: dto }
  }

  /** Creates the PRESENT record (idempotent under a race), uses a lesson for lesson-based subscriptions, publishes and notifies. */
  private async recordPresence(session: SessionRow, studentId: string, method: 'QR' | 'CENTER_QR', meta: { ip?: string; userAgent?: string }, extra: { distanceM?: number | null } = {}) {
    const dto = SessionsService.toDto(session)
    try {
      const record = await this.prisma.tx(async (tx) => {
        const row = await tx.attendanceRecord.create({
          data: { tenantId: session.tenantId, sessionId: session.id, studentId, status: 'PRESENT', method, checkedInAt: new Date(), recordedById: studentId, tokenVersion: session.tokenVersion, ip: meta.ip, userAgent: meta.userAgent },
        })
        await this.subscriptions.consumeLesson(tx, session.tenantId, studentId, row.id)
        return row
      })
      await this.audit.record({ action: 'attendance.check_in', entityType: 'AttendanceRecord', entityId: record.id, after: { sessionId: session.id, method, distanceM: extra.distanceM ?? undefined } })
      const out = toRecord(record)
      await this.events.publish(session.id, { type: 'record', record: out })
      await this.notifyCheckIn(session, studentId, out)
      return { ok: true as const, alreadyRecorded: false, record: out, session: dto }
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        const race = await this.prisma.client.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId } } })
        if (race) return { ok: true as const, alreadyRecorded: true, record: toRecord(race), session: dto }
      }
      throw err
    }
  }

  /** What every lesson notification carries: enough to render the text and to open the lesson's group or day. */
  private lessonParams(session: { id?: string; date: Date; startsAt: Date; course: { id: string; title: unknown; centerId?: string }; group: { id?: string; name: string; timezone: string } }) {
    return { courseTitle: session.course.title, courseId: session.course.id, centerId: session.course.centerId ?? null, groupName: session.group.name, groupId: session.group.id ?? null, sessionId: session.id ?? null, date: dateColumnToIso(session.date), start: localTime(session.startsAt, session.group.timezone) }
  }

  private async notifyCheckIn(session: { tenantId: string; course: { id: string; title: unknown; teacherId: string }; group: { name: string; timezone: string }; date: Date; startsAt: Date }, studentId: string, record: RecordDto) {
    await this.notifications.safely('attendance.checkin', async () => {
      const [teacherUserId, student] = await Promise.all([this.notifications.teacherUserId(session.course.teacherId), this.prisma.client.user.findFirst({ where: { id: studentId }, select: { displayName: true } })])
      if (!teacherUserId) return
      await this.notifications.notify({ tenantId: session.tenantId, userIds: [teacherUserId], type: 'attendance.checkin', params: { ...this.lessonParams(session), studentName: student?.displayName ?? '', studentId, time: record.checkedInAt }, dedupeKey: `checkin:${record.id}` })
    })
  }

  private async notifyGroup(session: { tenantId: string; groupId: string; course: { teacherId: string } }, type: string, params: Record<string, unknown>, dedupeKey: string) {
    await this.notifications.safely(type, async () => {
      const [students, teacher] = await Promise.all([this.notifications.groupStudentIds(session.groupId), this.notifications.teacherUserId(session.course.teacherId)])
      await this.notifications.notify({ tenantId: session.tenantId, userIds: [...students, ...(teacher ? [teacher] : [])], type, params, dedupeKey })
    })
  }

  // ───────── absences (worker) ─────────

  /**
   * Records ABSENT / AUTO for every active enrollment without a record once a lesson's check-in window closed, then stamps
   * the lesson so it is processed once. Idempotent across workers (unique record per student and lesson; conditional stamp).
   */
  async markAbsences(tenantId: string, now = new Date()): Promise<{ sessions: number; absent: number }> {
    const candidates = await this.prisma.client.lessonSession.findMany({
      where: { tenantId, absenceMarkedAt: null, status: { not: 'CANCELLED' }, startsAt: { lte: now } },
      include: { course: { select: { id: true, title: true, teacherId: true, centerId: true, center: { select: { absenceAfterMin: true } } } }, group: { select: { id: true, name: true, timezone: true, days: true } } },
      orderBy: { startsAt: 'asc' },
      take: 200,
    })
    let sessions = 0
    let absent = 0
    for (const s of candidates) {
      if (now.getTime() < s.startsAt.getTime() + s.course.center.absenceAfterMin * 60_000) continue
      const [roster, recorded] = await Promise.all([
        this.prisma.client.enrollment.findMany({ where: { groupId: s.groupId, status: 'ACTIVE' }, select: { studentId: true } }),
        this.prisma.client.attendanceRecord.findMany({ where: { sessionId: s.id }, select: { studentId: true } }),
      ])
      const have = new Set(recorded.map((r) => r.studentId))
      const missing = roster.map((r) => r.studentId).filter((id) => !have.has(id))
      // The stamp and the records land together: a crash between them would leave a stamped lesson without its absences.
      const res = await this.prisma.tx(async (tx) => {
        const stamped = await tx.lessonSession.updateMany({ where: { id: s.id, absenceMarkedAt: null }, data: { absenceMarkedAt: now } })
        if (stamped.count !== 1) return null // another worker took this lesson
        if (missing.length === 0) return { count: 0 }
        return tx.attendanceRecord.createMany({
          data: missing.map((studentId) => ({ tenantId, sessionId: s.id, studentId, status: 'ABSENT' as const, method: 'AUTO' as const, checkedInAt: now, recordedById: null, reason: 'No check-in before the window closed' })),
          skipDuplicates: true,
        })
      })
      if (!res) continue
      sessions++
      if (missing.length === 0) continue
      absent += res.count
      const rows = await this.prisma.client.attendanceRecord.findMany({ where: { sessionId: s.id, studentId: { in: missing } } })
      for (const r of rows) await this.events.publish(s.id, { type: 'record', record: toRecord(r) })
      const params = this.lessonParams(s)
      await this.notifications.safely('attendance.absent', async () => {
        await this.notifications.notify({ tenantId, userIds: missing, type: 'attendance.absent', params, dedupeKey: `absent:${s.id}` })
        const admins = await this.notifications.centerAdminIds(tenantId, s.course.centerId)
        await this.notifications.notify({ tenantId, userIds: admins, type: 'attendance.absences', params: { ...params, count: missing.length }, dedupeKey: `absences:${s.id}` })
      })
      await this.audit.record({ action: 'attendance.auto_absent', entityType: 'LessonSession', entityId: s.id, after: { absent: res.count } })
    }
    if (sessions) this.logger.log(`Absences for ${tenantId}: ${absent} records across ${sessions} lessons`)
    return { sessions, absent }
  }

  // ───────── schedule exceptions ─────────

  private groupForManager(groupId: string, actor: RequestActor) {
    return this.prisma.client.group.findFirst({ where: { id: groupId }, include: { course: { select: { id: true, title: true, teacherId: true, centerId: true } } } }).then((group) => {
      if (!group) throw AppError.notFound('Group')
      this.assertOwnership(group.course, actor)
      return group
    })
  }

  private instants(date: string, start: string, end: string, timezone: string) {
    if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw AppError.invalid('invalid_date', 'Date must be YYYY-MM-DD')
    if (!HHMM.test(start) || !HHMM.test(end) || start >= end) throw AppError.invalid('invalid_schedule', 'start time must be before end time')
    return { startsAt: zonedTimeToUtc(date, start, timezone), endsAt: zonedTimeToUtc(date, end, timezone) }
  }

  /** A one-off lesson outside the weekly pattern (or on a weekly day that has no session yet). */
  async addExtraSession(groupId: string, actor: RequestActor, input: { date: string; start: string; end: string; note?: string }) {
    const group = await this.groupForManager(groupId, actor)
    await this.assertCenterWritable(group.course.centerId, actor)
    const { startsAt, endsAt } = this.instants(input.date, input.start, input.end, group.timezone)
    const clash = await this.prisma.client.lessonSession.findFirst({ where: { groupId, date: isoToDateColumn(input.date) }, select: { id: true, status: true } })
    if (clash) throw AppError.conflict('session_exists', 'The group already has a lesson on that date; move or restore it instead', { sessionId: clash.id, status: clash.status.toLowerCase() })
    const session = await this.prisma.client.lessonSession.create({
      data: { tenantId: group.tenantId, groupId, courseId: group.courseId, date: isoToDateColumn(input.date), startsAt, endsAt, status: endsAt < new Date() ? 'COMPLETED' : 'SCHEDULED', absenceMarkedAt: endsAt < new Date() ? new Date() : null, isExtra: true, note: input.note?.trim() || null, generatedBy: `user:${actor.id}` },
      include: SESSION_INCLUDE,
    })
    await this.audit.record({ action: 'session.extra', entityType: 'LessonSession', entityId: session.id, after: { date: input.date, start: input.start, end: input.end } })
    await this.notifyGroup(session, 'schedule.extra', { ...this.lessonParams(session), note: session.note }, `session-extra:${session.id}`)
    return { session: SessionsService.toDto(session) }
  }

  /**
   * Moves a lesson. Same date: the times change in place. Another date: the original is cancelled (it keeps its history)
   * and a new lesson is created that points back to it. Lessons that already have attendance cannot be moved.
   */
  async rescheduleSession(sessionId: string, actor: RequestActor, input: { date?: string; start?: string; end?: string; note?: string }) {
    const session = await this.sessionForWrite(sessionId, actor)
    if (session.status === 'CANCELLED') throw AppError.invalid('session_cancelled', 'Restore the lesson before moving it')
    if ((await this.prisma.client.attendanceRecord.count({ where: { sessionId: session.id } })) > 0) throw AppError.conflict('has_attendance', 'A lesson with attendance records cannot be moved')
    const tz = session.group.timezone
    const fromDate = dateColumnToIso(session.date)
    const date = input.date ?? fromDate
    const start = input.start ?? localTime(session.startsAt, tz)
    const end = input.end ?? localTime(session.endsAt, tz)
    const { startsAt, endsAt } = this.instants(date, start, end, tz)
    const note = input.note !== undefined ? input.note.trim() || null : session.note
    const before = { date: fromDate, start: localTime(session.startsAt, tz), end: localTime(session.endsAt, tz) }
    let result
    if (date === fromDate) {
      result = await this.prisma.client.lessonSession.update({ where: { id: session.id }, data: { startsAt, endsAt, note, status: endsAt < new Date() ? 'COMPLETED' : 'SCHEDULED', absenceMarkedAt: endsAt < new Date() ? new Date() : null, attendanceOpen: false, attendanceTokenHash: null, attendanceTokenExpiresAt: null }, include: SESSION_INCLUDE })
    } else {
      const clash = await this.prisma.client.lessonSession.findFirst({ where: { groupId: session.groupId, date: isoToDateColumn(date) }, select: { id: true, status: true } })
      if (clash) throw AppError.conflict('session_exists', 'The group already has a lesson on that date', { sessionId: clash.id, status: clash.status.toLowerCase() })
      result = await this.prisma.tx(async (tx) => {
        await tx.lessonSession.update({ where: { id: session.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.id, attendanceOpen: false, attendanceTokenHash: null, attendanceTokenExpiresAt: null, absenceMarkedAt: new Date(), note } })
        return tx.lessonSession.create({
          data: { tenantId: session.tenantId, groupId: session.groupId, courseId: session.courseId, date: isoToDateColumn(date), startsAt, endsAt, status: endsAt < new Date() ? 'COMPLETED' : 'SCHEDULED', absenceMarkedAt: endsAt < new Date() ? new Date() : null, isExtra: true, rescheduledFromId: session.id, note, generatedBy: `user:${actor.id}` },
          include: SESSION_INCLUDE,
        })
      })
      await this.events.publish(session.id, { type: 'session', session: SessionsService.toDto({ ...session, status: 'CANCELLED' }) })
    }
    await this.audit.record({ action: 'session.reschedule', entityType: 'LessonSession', entityId: session.id, before, after: { date, start, end, newSessionId: result.id !== session.id ? result.id : undefined } })
    await this.events.publish(result.id, { type: 'session', session: SessionsService.toDto(result) })
    await this.notifyGroup(result, 'schedule.changed', { ...this.lessonParams(result), fromDate: before.date, fromStart: before.start, note }, `session-moved:${result.id}:${result.startsAt.toISOString()}`)
    return { session: SessionsService.toDto(result), replacedSessionId: result.id !== session.id ? session.id : null }
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
      this.prisma.client.lessonSession.findMany({ where: { groupId: { in: groupIds } }, orderBy: { startsAt: 'asc' }, include: { group: { select: { timezone: true } } } }),
      this.prisma.client.attendanceRecord.findMany({ where: { studentId }, orderBy: { checkedInAt: 'desc' } }),
    ])
    return { sessions: sessions.map(SessionsService.toDto), records: records.map(toRecord) }
  }

  /** Used by workers that iterate tenants. */
  static forTenant<T>(tenantId: string, fn: () => Promise<T>) {
    return TenantContext.forTenant(tenantId, fn)
  }
}

export type { TransactionClient }
