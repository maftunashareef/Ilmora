import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { pick } from '@ilmora/shared'
import { ENV, type Env } from '../../config/env'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { RedisService } from '../../infra/redis/redis.service'
import { type GenerateDailyJobData, type GenerateGroupJobData, JOBS, QUEUES, type SmsJobData, jobId } from '../../infra/queue/queues'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { LOCAL_TIMEZONE, todayLocal, zonedTimeToUtc } from '../../common/time'
import { AttendanceService } from '../attendance/attendance.service'
import { SmsService } from '../sms/sms.service'
import { TenantsService } from '../tenants/tenants.service'
import { SessionsService } from './sessions.service'

/** A daily run still «RUNNING» after this long was interrupted and may be run again (Н13); a real run takes minutes. */
export const STALE_RUN_MS = 3 * 3_600_000
/** How often a live worker marks itself in Redis, and how long the mark lasts (Н13). */
export const WORKER_BEAT_MS = 20_000
export const WORKER_ALIVE_MS = 60_000
export const aliveKey = (workerId: string) => `worker:alive:${workerId}`

/**
 * Worker for the `sessions` queue.
 *  - generate-daily: runs once per local date (job id + JobRun row make it exclusive across workers),
 *    materializes the horizon for every group and queues lesson reminders for tomorrow. It never creates attendance.
 *  - generate-group: targeted regeneration after a group's schedule changes.
 *  - mark-absences: every few minutes, records absences for lessons whose check-in window closed.
 */
@Processor(QUEUES.sessions, { concurrency: 1 })
export class SessionsProcessor extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionsProcessor.name)
  /** This process: the machine, the pid and a per-start id — a restarted worker (same container, pid 1) is a new one. */
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
  /** Daily runs this process is executing right now. */
  private readonly running = new Set<string>()
  private heartbeat?: ReturnType<typeof setInterval>

  constructor(
    private readonly sessions: SessionsService,
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly sms: SmsService,
    private readonly attendance: AttendanceService,
    @InjectQueue(QUEUES.sessions) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {
    super()
  }

  onModuleDestroy() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (!this.redis.off) void this.redis.cache.del(aliveKey(this.workerId)).catch(() => undefined)
  }

  /** A live worker marks itself every WORKER_BEAT_MS; the mark lasts WORKER_ALIVE_MS. */
  private async beat() {
    if (this.redis.off) return
    await this.redis.cache.set(aliveKey(this.workerId), '1', 'PX', WORKER_ALIVE_MS).catch(() => undefined)
  }

  /**
   * Whether the worker that holds a «RUNNING» row is still alive (Н13). Without Redis there is one process: any other
   * worker is a previous start of it. With Redis, a worker that stopped marking itself — killed by a deploy or a
   * restart mid-run — is gone; if Redis cannot answer, the run is left alone (STALE_RUN_MS is the last resort).
   */
  private async isAlive(workerId: string | null): Promise<boolean> {
    if (!workerId) return false
    if (workerId === this.workerId) return true
    if (this.redis.off) return false
    try {
      return (await this.redis.cache.exists(aliveKey(workerId))) === 1
    } catch {
      return true
    }
  }

  /** Repeatable schedules (BullMQ job schedulers are upsert-safe across replicas). */
  async onModuleInit() {
    await this.beat()
    this.heartbeat = setInterval(() => void this.beat(), WORKER_BEAT_MS)
    this.heartbeat.unref?.()
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
  private async runOnce(queue: string, key: string, fn: (date: string) => Promise<unknown>): Promise<unknown> {
    const date = key.replace(/^daily-/, '')
    let run
    try {
      run = await TenantContext.system(() => this.prisma.client.jobRun.create({ data: { queue, jobKey: key, workerId: this.workerId } }))
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        // The run of this key exists. It is taken over when it failed, when the worker that holds it is gone (a deploy or
        // a restart killed it mid-run: the queue retries in 30 s and used to see «running» and skip — the day was lost, Н13),
        // or — the last resort — when it has been «running» for STALE_RUN_MS. A finished run, or one a live worker is
        // executing, is left alone.
        const row = await TenantContext.system(() => this.prisma.client.jobRun.findFirst({ where: { queue, jobKey: key }, select: { id: true, status: true, workerId: true, startedAt: true } }))
        const abandoned = row && row.status === 'RUNNING' && !this.running.has(key) && (row.startedAt < new Date(Date.now() - STALE_RUN_MS) || !(await this.isAlive(row.workerId === this.workerId ? null : row.workerId)))
        if (row && (row.status === 'FAILED' || abandoned)) {
          // deleteMany: two workers taking over the same run — only one deletes it, the other one's create then fails.
          if (abandoned) this.logger.warn(`Taking over ${queue}/${key}: its worker ${row.workerId} is gone`)
          await TenantContext.system(() => this.prisma.client.jobRun.deleteMany({ where: { id: row.id, status: row.status } }))
          return this.runOnce(queue, key, fn)
        }
        this.logger.log(`Skipping ${queue}/${key}: ${row?.status === 'SUCCEEDED' ? 'already done' : 'running in a live worker'}`)
        return { skipped: true }
      }
      throw err
    }
    this.running.add(key)
    try {
      const result = await TenantContext.system(() => fn(date))
      await TenantContext.system(() => this.prisma.client.jobRun.updateMany({ where: { id: run.id }, data: { status: 'SUCCEEDED', finishedAt: new Date(), result: result as object } }))
      return result
    } catch (err) {
      await TenantContext.system(() => this.prisma.client.jobRun.updateMany({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), error: String((err as Error).message).slice(0, 500) } }))
      throw err
    } finally {
      this.running.delete(key)
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
        // A run taken over after a restart (Н13) must not text anyone twice: the reminders a phone already got today are
        // skipped, in the order of its lessons (one text per lesson, several lessons — several texts).
        const since = zonedTimeToUtc(todayLocal(), '00:00', LOCAL_TIMEZONE)
        const phones = [...new Set(list.flatMap((s) => s.group.enrollments.map((e) => e.student.phoneE164).filter((p): p is string => !!p)))]
        const sent = phones.length ? await this.prisma.client.smsMessage.groupBy({ by: ['phoneE164'], where: { tenantId, templateKey: 'sms.reminder', phoneE164: { in: phones }, createdAt: { gte: since } }, _count: { _all: true } }) : []
        const already = new Map(sent.map((r) => [r.phoneE164, r._count._all]))
        for (const s of [...list].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))) {
          for (const e of s.group.enrollments) {
            if (!e.student.reminders || !e.student.phoneE164) continue
            const left = already.get(e.student.phoneE164) ?? 0
            if (left > 0) { already.set(e.student.phoneE164, left - 1); continue }
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
