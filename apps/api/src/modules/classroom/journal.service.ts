import { Injectable } from '@nestjs/common'
import { attendancePercent, countsAsAttended, type JournalMark } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { dateColumnToIso, isoToDateColumn, todayLocal } from '../../common/time'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { assertGroupWritable, assertManages, loadGroup } from './group-access'

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
}

/**
 * The group journal (ТЗ 2026-11-18, раздел 5): rows — the group's students of both kinds, columns — the lessons of a
 * month. The center's own students are marked by the teacher (был, не был, опоздал), every mark and change audited.
 * Students who came through ILMORA are marked by QR (AttendanceRecord) and read-only here: lessons of their subscription
 * depend on those marks, a disputed one is corrected by the Super Admin.
 */
@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private get db() {
    return this.prisma.client
  }

  async journal(groupId: string, actor: RequestActor, month?: string) {
    const group = await loadGroup(this.prisma, groupId)
    assertManages(group, actor, { centerAdmin: true, centerManager: true })
    const today = todayLocal()
    const m = month ?? today.slice(0, 7)
    if (!MONTH.test(m)) throw AppError.invalid('validation_failed', 'month must be YYYY-MM')
    const now = new Date()
    const [sessions, enrollments, links, past] = await Promise.all([
      this.db.lessonSession.findMany({ where: { groupId, date: { gte: isoToDateColumn(`${m}-01`), lt: isoToDateColumn(`${nextMonth(m)}-01`) } }, orderBy: { startsAt: 'asc' }, select: { id: true, date: true, startsAt: true, endsAt: true, status: true } }),
      this.db.enrollment.findMany({
        where: { groupId, status: { in: ['ACTIVE', 'COMPLETED'] } },
        select: { studentId: true, enrolledAt: true, student: { select: { displayName: true, studentProfile: { select: { course: true, institution: { select: { name: true, type: true } } } } } } },
        orderBy: { enrolledAt: 'asc' },
      }),
      this.db.centerStudentGroup.findMany({
        where: { groupId, centerStudent: { centerId: group.course.centerId, status: { not: 'LEFT' } } },
        select: { createdAt: true, centerStudent: { select: { id: true, fullName: true, userId: true, status: true, startedOn: true, studyYear: true, institutionText: true, institutionType: true, institution: { select: { name: true, type: true } } } } },
      }),
      this.db.lessonSession.findMany({ where: { groupId, status: { not: 'CANCELLED' }, endsAt: { lt: now } }, select: { id: true, date: true, startsAt: true } }),
    ])
    const viaIlmora = new Set(enrollments.map((e) => e.studentId))
    const own = links.filter((l) => !(l.centerStudent.userId && viaIlmora.has(l.centerStudent.userId)))
    const sessionIds = [...new Set([...sessions.map((s) => s.id), ...past.map((s) => s.id)])]
    const [records, marks] = await Promise.all([
      enrollments.length && sessionIds.length ? this.db.attendanceRecord.findMany({ where: { sessionId: { in: sessionIds }, studentId: { in: [...viaIlmora] } }, select: { sessionId: true, studentId: true, status: true, method: true } }) : [],
      own.length && sessionIds.length ? this.db.centerAttendanceMark.findMany({ where: { sessionId: { in: sessionIds }, centerStudentId: { in: own.map((l) => l.centerStudent.id) } }, select: { sessionId: true, centerStudentId: true, status: true } }) : [],
    ])
    const inMonth = new Set(sessions.map((s) => s.id))

    const ilmoraRows = enrollments.map((e) => {
      const mine = records.filter((r) => r.studentId === e.studentId)
      const counted = past.filter((s) => s.startsAt >= e.enrolledAt)
      const attended = counted.filter((s) => mine.some((r) => r.sessionId === s.id && r.status === 'PRESENT')).length
      return {
        kind: 'ilmora' as const, id: e.studentId, name: e.student.displayName, editable: false,
        institution: e.student.studentProfile?.institution ?? null, studyYear: e.student.studentProfile?.course ?? null,
        marks: Object.fromEntries(mine.filter((r) => inMonth.has(r.sessionId)).map((r) => [r.sessionId, { status: r.status, method: r.method }])),
        attendance: { attended, total: counted.length, percent: attendancePercent(attended, counted.length) },
      }
    })
    const centerRows = own.map((l) => {
      const cs = l.centerStudent
      const from = cs.startedOn ? dateColumnToIso(cs.startedOn) : todayLocal(l.createdAt)
      const mine = marks.filter((x) => x.centerStudentId === cs.id)
      // Lessons since the start date, and any earlier lesson the teacher did mark (the table counts the same way).
      const counted = past.filter((s) => dateColumnToIso(s.date) >= from || mine.some((x) => x.sessionId === s.id))
      const attended = counted.filter((s) => countsAsAttended(mine.find((x) => x.sessionId === s.id)?.status)).length
      return {
        kind: 'center' as const, id: cs.id, name: cs.fullName, editable: true, status: cs.status,
        institution: cs.institution ?? (cs.institutionText ? { name: cs.institutionText, type: cs.institutionType } : null), studyYear: cs.studyYear,
        marks: Object.fromEntries(mine.filter((x) => inMonth.has(x.sessionId)).map((x) => [x.sessionId, { status: x.status, method: 'MANUAL' }])),
        attendance: { attended, total: counted.length, percent: attendancePercent(attended, counted.length) },
      }
    }).sort((a, b) => a.name.localeCompare(b.name))

    return {
      group: { id: group.id, name: group.name, courseId: group.course.id, courseTitle: group.course.title, centerName: group.course.center.name, timezone: group.timezone },
      month: m,
      today,
      sessions: sessions.map((s) => ({
        id: s.id, date: dateColumnToIso(s.date), startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), status: s.status.toLowerCase(),
        // A mark is for a lesson of today or earlier, never a cancelled one.
        markable: s.status !== 'CANCELLED' && dateColumnToIso(s.date) <= today,
      })),
      rows: [...ilmoraRows, ...centerRows],
    }
  }

  /**
   * Sets, changes or clears the mark of one of the center's own students for one lesson. Refused for a student who is in
   * the group through ILMORA (their mark is the QR check-in), for a cancelled lesson and for a lesson still to come.
   */
  async setMark(groupId: string, actor: RequestActor, input: { sessionId: string; centerStudentId: string; status: JournalMark | null }) {
    const group = await loadGroup(this.prisma, groupId)
    assertManages(group, actor, { centerAdmin: true })
    assertGroupWritable(group, actor)
    const session = await this.db.lessonSession.findFirst({ where: { id: input.sessionId, groupId }, select: { id: true, date: true, status: true } })
    if (!session) throw AppError.notFound('Session')
    if (session.status === 'CANCELLED') throw AppError.invalid('session_cancelled', 'A cancelled lesson has no attendance')
    if (dateColumnToIso(session.date) > todayLocal()) throw AppError.invalid('session_not_yet', 'The lesson has not taken place yet')
    const link = await this.db.centerStudentGroup.findFirst({
      where: { groupId, centerStudentId: input.centerStudentId, centerStudent: { centerId: group.course.centerId } },
      select: { centerStudent: { select: { id: true, userId: true, status: true } } },
    })
    if (!link) throw AppError.notFound('Student')
    const cs = link.centerStudent
    if (cs.userId && (await this.db.enrollment.count({ where: { groupId, studentId: cs.userId, status: { in: ['ACTIVE', 'COMPLETED'] } } })) > 0) {
      throw AppError.forbidden('This student is marked by QR', { code: 'qr_read_only' })
    }
    const key = { sessionId_centerStudentId: { sessionId: session.id, centerStudentId: cs.id } }
    const before = await this.db.centerAttendanceMark.findUnique({ where: key })
    if ((before?.status ?? null) === input.status) return { sessionId: session.id, centerStudentId: cs.id, status: input.status }
    await this.prisma.tx(async (tx) => {
      let entityId = before?.id
      if (input.status === null) await tx.centerAttendanceMark.delete({ where: key })
      else if (before) await tx.centerAttendanceMark.update({ where: key, data: { status: input.status, markedById: actor.id, version: { increment: 1 } } })
      else entityId = (await tx.centerAttendanceMark.create({ data: { tenantId: group.tenantId, sessionId: session.id, centerStudentId: cs.id, status: input.status, markedById: actor.id } })).id
      await this.audit.record({
        tx, action: before ? (input.status === null ? 'attendance.center_mark_clear' : 'attendance.center_mark_change') : 'attendance.center_mark',
        entityType: 'CenterAttendanceMark', entityId: entityId ?? `${session.id}:${cs.id}`,
        before: before ? { status: before.status } : undefined, after: { status: input.status, sessionId: session.id, centerStudentId: cs.id },
      })
    })
    return { sessionId: session.id, centerStudentId: cs.id, status: input.status }
  }
}
