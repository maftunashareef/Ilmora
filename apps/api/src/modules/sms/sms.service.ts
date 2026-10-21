import { InjectQueue } from '@nestjs/bullmq'
import { Inject, Injectable } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { encryptString } from '../../common/crypto'
import { ENV, type Env } from '../../config/env'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { JOBS, QUEUES, type SmsJobData, jobId } from '../../infra/queue/queues'

export interface EnqueueSmsInput {
  tenantId: string
  phoneE164: string
  templateKey: string
  lang: 'uz' | 'ru' | 'en'
  vars?: Record<string, string>
  /** Values that must not sit in plain text in the queue (one-time codes); encrypted before enqueueing. */
  secretVars?: Record<string, string>
}

/** Producer side: persists an SmsMessage row (audit trail without message text) and enqueues delivery. */
@Injectable()
export class SmsService {
  constructor(private readonly prisma: PrismaService, @InjectQueue(QUEUES.sms) private readonly queue: Queue<SmsJobData>, @Inject(ENV) private readonly env: Env) {}

  async enqueue(input: EnqueueSmsInput): Promise<string> {
    const row = await this.prisma.client.smsMessage.create({
      data: { tenantId: input.tenantId, phoneE164: input.phoneE164, templateKey: input.templateKey, lang: input.lang },
    })
    const data: SmsJobData = {
      tenantId: input.tenantId,
      smsMessageId: row.id,
      phoneE164: input.phoneE164,
      templateKey: input.templateKey,
      lang: input.lang,
      vars: input.vars,
      encryptedVars: input.secretVars ? encryptString(JSON.stringify(input.secretVars), this.env.OTP_JOB_ENCRYPTION_KEY) : undefined,
    }
    // Job id = message id: a retried enqueue for the same message never creates a second delivery.
    await this.queue.add(JOBS.sms.send, data, { jobId: jobId('sms', row.id), attempts: 4, backoff: { type: 'exponential', delay: 3_000 } })
    return row.id
  }
}
