import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, type OnModuleInit } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { pick } from '@ilmora/shared'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { JOBS, QUEUES } from '../../infra/queue/queues'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { SmsService } from '../sms/sms.service'
import { OutboxService } from './outbox.service'
import { PaymentsService } from './payments.service'

/**
 * Worker: drains the transactional outbox (receipts, refund notices) every 20 s and expires stale payments
 * every 10 minutes. Both are repeatable BullMQ jobs; multiple workers are safe (SKIP LOCKED / unique keys).
 */
@Processor(QUEUES.outbox, { concurrency: 1 })
export class OutboxProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(OutboxProcessor.name)

  constructor(
    private readonly outbox: OutboxService,
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly payments: PaymentsService,
    @InjectQueue(QUEUES.outbox) private readonly queue: Queue,
  ) {
    super()
  }

  async onModuleInit() {
    await this.queue.upsertJobScheduler('outbox-dispatch', { every: 20_000 }, { name: JOBS.outbox.dispatch, data: {} })
    await this.queue.upsertJobScheduler('payments-expire', { every: 10 * 60_000 }, { name: JOBS.maintenance.expirePayments, data: {} })
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === JOBS.maintenance.expirePayments) return { expired: await this.payments.expireAll() }
    const events = await TenantContext.system(() => this.outbox.claim(50))
    let done = 0
    for (const ev of events) {
      try {
        await TenantContext.system(() => this.dispatch(ev), { tenantId: ev.tenantId })
        await TenantContext.system(() => this.outbox.markDone(ev.id))
        done++
      } catch (err) {
        this.logger.warn(`outbox ${ev.type} ${ev.id} failed: ${(err as Error).message}`)
        await TenantContext.system(() => this.outbox.markFailed(ev.id, ev.attempts, (err as Error).message))
      }
    }
    return { claimed: events.length, done }
  }

  private async dispatch(ev: { id: string; tenantId: string | null; type: string; payload: unknown }) {
    const payload = (ev.payload ?? {}) as Record<string, unknown>
    switch (ev.type) {
      case 'payment.receipt':
        return this.receipt(ev.tenantId!, String(payload.paymentId))
      case 'payment.refunded':
      case 'payment.refund_required':
        // Visible to finance admins through the reconciliation screen and the audit log; no automatic money movement.
        return this.prisma.client.auditEvent.create({ data: { tenantId: ev.tenantId!, action: ev.type, entityType: 'Payment', entityId: String(payload.paymentId), after: payload as object } })
      default:
        this.logger.warn(`Unknown outbox event type ${ev.type}`)
    }
  }

  private async receipt(tenantId: string, paymentId: string) {
    const payment = await this.prisma.client.payment.findFirst({ where: { id: paymentId }, include: { student: { select: { phoneE164: true, preferredLang: true } }, receipt: true } })
    if (!payment) return
    let receipt = payment.receipt
    if (!receipt) {
      const count = await this.prisma.client.receipt.count({ where: { tenantId } })
      receipt = await this.prisma.client.receipt.create({ data: { tenantId, paymentId, number: `R-${new Date().getUTCFullYear()}-${String(count + 1).padStart(6, '0')}` } })
    }
    if (!payment.student.phoneE164) return // receipt exists; the account has no phone to text
    const lang = payment.student.preferredLang
    const period = `${payment.periodStart.toISOString().slice(0, 10)} – ${payment.periodEnd.toISOString().slice(0, 10)}`
    await this.sms.enqueue({
      tenantId,
      phoneE164: payment.student.phoneE164,
      templateKey: 'sms.receipt',
      lang,
      vars: { amount: (payment.amountMinor / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '), number: receipt.number, period },
    })
    await this.prisma.client.receipt.update({ where: { id: receipt.id }, data: { deliveredAt: new Date(), channel: 'sms' } })
    void pick
  }
}
