import { Inject, Injectable, Logger } from '@nestjs/common'
import { scheduleDates } from '@ilmora/shared'
import { addDays, dateColumnToIso, isoToDateColumn, localDate, localTime, zonedTimeToUtc } from '../../common/time'
import { ENV, type Env } from '../../config/env'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { TenantsService } from '../tenants/tenants.service'

type GroupRow = { id: string; tenantId: string; courseId: string; days: number[]; startTime: string; endTime: string; timezone: string }

/**
 * Materializes lesson sessions from weekly schedules. Idempotent: (groupId, date) is unique and existing
 * rows are never modified, so any number of workers or re-runs converge on the same calendar.
 */
/** Schema default for Group.timezone; every Tashkent centre uses it. */
const DEFAULT_TIMEZONE = 'Asia/Tashkent'

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name)

  constructor(private readonly prisma: PrismaService, private readonly tenants: TenantsService, @Inject(ENV) private readonly env: Env) {}

  /** Create missing sessions for one group between fromDate (inclusive) and fromDate + days. Returns how many were added. */
  async generateForGroup(group: GroupRow, fromDate: string, days: number, generatedBy: string, db: TransactionClient | PrismaService['client'] = this.prisma.client): Promise<number> {
    const now = new Date()
    const [fy, fm, fd] = fromDate.split('-').map(Number)
    const dates = scheduleDates(group.days, new Date(fy, fm - 1, fd), days)
    if (!dates.length) return 0
    const rows = dates.map((date: string) => {
      const startsAt = zonedTimeToUtc(date, group.startTime, group.timezone)
      const endsAt = zonedTimeToUtc(date, group.endTime, group.timezone)
      return { tenantId: group.tenantId, groupId: group.id, courseId: group.courseId, date: isoToDateColumn(date), startsAt, endsAt, status: endsAt < now ? ('COMPLETED' as const) : ('SCHEDULED' as const), absenceMarkedAt: endsAt < now ? now : null, generatedBy }
    })
    const res = await db.lessonSession.createMany({ data: rows, skipDuplicates: true })
    return res.count
  }

  /** Daily horizon run for every tenant and active group. Returns a summary for the JobRun row. */
  async generateDaily(forDate: string, generatedBy: string): Promise<{ tenants: number; groups: number; created: number }> {
    const horizon = this.env.SESSION_HORIZON_DAYS
    let groups = 0
    let created = 0
    const tenantIds = await this.tenants.listIds()
    for (const tenantId of tenantIds) {
      await TenantContext.forTenant(tenantId, async () => {
        const list = await this.prisma.client.group.findMany({ where: { tenantId, course: { deletedAt: null, status: { not: 'ARCHIVED' } } } })
        for (const g of list) {
          groups++
          created += await this.generateForGroup(g, forDate, horizon, generatedBy)
        }
        // Sessions whose end time passed are marked completed (attendance stays open only if a teacher left it open).
        await this.prisma.client.lessonSession.updateMany({ where: { tenantId, status: 'SCHEDULED', endsAt: { lt: new Date() } }, data: { status: 'COMPLETED' } })
      })
    }
    this.logger.log(`Daily session generation for ${forDate}: ${created} created across ${groups} groups in ${tenantIds.length} tenants`)
    return { tenants: tenantIds.length, groups, created }
  }

  todayLocal(now = new Date()): string {
    return localDate(now, this.env.SCHEDULE_TIMEZONE)
  }

  /** Sessions tomorrow (local) with enrolled students who opted into reminders. */
  async sessionsForReminders(tenantId: string, now = new Date()) {
    const tomorrow = addDays(this.todayLocal(now), 1)
    return this.prisma.client.lessonSession.findMany({
      where: { tenantId, date: isoToDateColumn(tomorrow), status: 'SCHEDULED' },
      include: { group: { include: { enrollments: { where: { status: 'ACTIVE' }, include: { student: { select: { id: true, phoneE164: true, preferredLang: true, reminders: true } } } } } }, course: { select: { title: true } } },
    })
  }

  /**
   * API shape of a session. `start`/`end` are wall-clock times in the group's timezone (the one the
   * timetable shows); pass the session with its `group` included to use a non-default timezone.
   */
  static toDto(s: { id: string; groupId: string; courseId: string; date: Date; startsAt: Date; endsAt: Date; status: string; attendanceOpen: boolean; attendanceOpenedAt: Date | null; attendanceClosedAt: Date | null; tokenVersion: number; isExtra?: boolean; note?: string | null; rescheduledFromId?: string | null; group?: { timezone?: string } | null }) {
    const timezone = s.group?.timezone ?? DEFAULT_TIMEZONE
    return {
      id: s.id,
      groupId: s.groupId,
      courseId: s.courseId,
      date: dateColumnToIso(s.date),
      start: localTime(s.startsAt, timezone),
      end: localTime(s.endsAt, timezone),
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      status: s.status.toLowerCase(),
      attendanceOpen: s.attendanceOpen,
      openedAt: s.attendanceOpenedAt?.toISOString(),
      closedAt: s.attendanceClosedAt?.toISOString(),
      tokenVersion: s.tokenVersion,
      isExtra: s.isExtra ?? false,
      note: s.note ?? undefined,
      rescheduledFromId: s.rescheduledFromId ?? undefined,
    }
  }
}
