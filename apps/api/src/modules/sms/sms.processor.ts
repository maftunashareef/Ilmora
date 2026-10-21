import { Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { QUEUES, type SmsJobData } from '../../infra/queue/queues'
import { SmsSender } from './sms.sender'

/** Worker side: delivers queued SMS jobs (BullMQ retries with backoff; the final failure stays visible in the failed set). */
@Processor(QUEUES.sms, { concurrency: 5 })
export class SmsProcessor extends WorkerHost {
  constructor(private readonly sender: SmsSender) {
    super()
  }

  async process(job: Job<SmsJobData>): Promise<void> {
    await this.sender.deliver(job.data, job.attemptsMade)
  }
}
