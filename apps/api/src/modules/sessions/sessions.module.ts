import { Module } from '@nestjs/common'
import { QueueModule } from '../../infra/queue/queue.module'
import { SessionsService } from './sessions.service'

/** Session generation service + queue producer. The processor is registered by the worker module. */
@Module({
  imports: [QueueModule.forFeature()],
  providers: [SessionsService],
  exports: [SessionsService, QueueModule],
})
export class SessionsModule {}
