import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleInit } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { hostname } from 'node:os'
import { pick } from '@ilmora/shared'
import { ENV, type Env } from '../../config/env'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { type GenerateDailyJobData, type GenerateGroupJobData, JOBS, QUEUES, type SmsJobData, jobId } from '../../infra/queue/queues'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { AttendanceService } from '../attendance/attendance.service'
import { SmsService } from '../sms/sms.service'
import { TenantsService } from '../tenants/tenants.service'
import { SessionsService } from './sessions.service'

/**
 * Worker for the `sessions` queue.
 *  - generate-daily: runs once per local date (job id + JobRun row make it exclusive across workers),
 *    materializes the horizon for every group and queues lesson reminders for tomorrow. It never creates attendance.
 *  - generate-group: targeted regeneration after a group's schedule changes.
 *  - mark-absences: every few minutes, records absences for lessons whose check-in window closed.
 */
@Processor(QUEUES.sessions, { concurrency: 1 })
export class SessionsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SessionsProcessor.name)
  private readonly workerId = `${hostname()}:${process.pid}`

  constructor(
    private readonly sessions: SessionsService,
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly sms: SmsService,
    private readonly attendance: AttendanceService,
    @InjectQueue(QUEUES.sessions) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {
    super()
  }

  /** Repeatable schedules (BullMQ job schedulers are upsert-safe across replicas). */
  async onModuleInit() {
    await this.queue.upsertJobScheduler('sessions-daily', { pattern: '30 0 * * *', tz: this.env.SCHEDULE_TIMEZONE }, { name: JOBS.sessions.generateDaily, data: {} })
    await this.queue.upsertJobScheduler('sessions-reminders', { pattern: '0 18 * * *', tz: this.env.SCHEDULE_TIMEZONE }, { name: 'queue-reminders', data: {} })
    await this.queue.upsertJobScheduler('sessions-absences', { every: this.env.ATTENDANCE_ABSENCE_SWEEP_MINUTES * 60_000 }, { name: JOBS.sessions.markAbsences, data: {} })
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOBS.sessions.generateDaily:
        return this.runOnce('sessions', `daily-${(job.data as GenerateDailyJobData).forDate ?? this.sessions.todayLocal()}`, (date) => this.sessions.generateDaily(date, `job:${job.id}`))
      case JOBS.sessions.generateGroup:
        return this.generateGroup(job.data as GenerateGroupJobData, `job:${job.id}`)
      case JOBS.sessions.markAbsences:
        return this.markAbsences()
      case 'queue-reminders':
        return this.runOnce('reminders', `daily-${this.sessions.todayLocal()}`, () => this.queueReminders())
      default:
        throw new Error(`Unknown job ${job.name}`)
    }
  }

  /** Absence sweep for every tenant; each lesson is stamped once, so overlapping runs are harmless. */
  private async markAbsences() {
    const total = { sessions: 0, absent: 0 }
    for (const tenantId of await this.tenants.listIds()) {
      const r = await TenantContext.forTenant(tenantId, () => this.attendance.markAbsences(tenantId))
      total.sessions += r.sessions
      total.absent += r.absent
    }
    return total
  }

  /** Exclusive execution per (queue, key): the JobRun unique constraint decides who runs. */
  private async runOnce(queue: string, key: string, fn: (date: string) => Promise<unknown>) {
    const date = key.replace(/^daily-/, '')
    let run
    try {
      run = await TenantContext.system(() => this.prisma.client.jobRun.create({ data: { queue, jobKey: key, workerId: this.workerId } }))
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        this.logger.log(`Skipping ${queue}/${key}: already executed by another worker`)
        return { skipped: true }
      }
      throw err
    }
    try {
      const result = await TenantContext.system(() => fn(date))
      await TenantContext.system(() => this.prisma.client.jobRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', finishedAt: new Date(), result: result as object } }))
      return result
    } catch (err) {
      await TenantContext.system(() => this.prisma.client.jobRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), error: String((err as Error).message).slice(0, 500) } }))
      throw err
    }
  }

  private async generateGroup(data: GenerateGroupJobData, generatedBy: string) {
    return TenantContext.forTenant(data.tenantId, async () => {
      const group = await this.prisma.client.group.findFirst({ where: { id: data.groupId } })
      if (!group) return { created: 0 }
      const created = await this.sessions.generateForGroup(group, data.fromDate, data.days, generatedBy)
      return { created }
    })
  }

  private async queueReminders() {
    let queued = 0
    for (const tenantId of await this.tenants.listIds()) {
      await TenantContext.forTenant(tenantId, async () => {
        const list = await this.sessions.sessionsForReminders(tenantId)
        for (const s of list) {
          for (const e of s.group.enrollments) {
            if (!e.student.reminders || !e.student.phoneE164) continue
            await this.sms.enqueue({
              tenantId,
              phoneE164: e.student.phoneE164,
              templateKey: 'sms.reminder',
              lang: e.student.preferredLang,
              vars: { time: s.group.startTime, course: pick(e.student.preferredLang, s.course.title as { uz: string; ru: string; en: string }), room: s.group.room },
            })
            queued++
          }
        }
      })
    }
    return { queued }
  }

  /** Producer helper used by the manage module after schedule edits. */
  static enqueueGroup(queue: Queue, data: GenerateGroupJobData) {
    return queue.add(JOBS.sessions.generateGroup, data, { jobId: jobId('group', data.groupId, data.fromDate), attempts: 3 })
  }
}

export type { SmsJobData }
