import { Module } from '@nestjs/common'
import { QueueModule } from '../../infra/queue/queue.module'
import { SmsInlineRunner } from './sms.inline'
import { SmsProviderFactory } from './sms.provider'
import { SmsSender } from './sms.sender'
import { SmsService } from './sms.service'

/** Producer module (API + worker). The BullMQ processor lives in the worker module; REDIS_MODE=off delivers inline. */
@Module({
  imports: [QueueModule.forFeature()],
  providers: [SmsService, SmsSender, SmsProviderFactory, SmsInlineRunner],
  exports: [SmsService, SmsSender, SmsProviderFactory, QueueModule],
})
export class SmsModule {}
