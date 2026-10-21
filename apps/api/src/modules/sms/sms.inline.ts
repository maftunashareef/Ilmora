import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { inlineJobs, REDIS_OFF } from '../../infra/queue/queue.module'
import { JOBS, QUEUES, type SmsJobData } from '../../infra/queue/queues'
import { SmsSender } from './sms.sender'

/** REDIS_MODE=off only: delivers SMS jobs in-process as soon as they are "enqueued". */
@Injectable()
export class SmsInlineRunner implements OnModuleInit {
  private readonly logger = new Logger(SmsInlineRunner.name)

  constructor(private readonly sender: SmsSender) {}

  onModuleInit() {
    if (!REDIS_OFF) return
    inlineJobs.on(`${QUEUES.sms}:${JOBS.sms.send}`, (data: SmsJobData) => {
      this.sender.deliver(data).catch((err) => this.logger.warn(`inline SMS failed: ${(err as Error).message}`))
    })
  }
}
