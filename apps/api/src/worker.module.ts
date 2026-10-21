import { Module } from '@nestjs/common'
import { CoreModule } from './core.module'
import { QueueModule } from './infra/queue/queue.module'
import { AuthModule } from './modules/auth/auth.module'
import { CatalogModule } from './modules/catalog/catalog.module'
import { EnrollmentModule } from './modules/enrollment/enrollment.module'
import { OutboxProcessor } from './modules/payments/outbox.processor'
import { PaymentsModule } from './modules/payments/payments.module'
import { SessionsModule } from './modules/sessions/sessions.module'
import { SessionsProcessor } from './modules/sessions/sessions.processor'
import { SmsModule } from './modules/sms/sms.module'
import { SmsProcessor } from './modules/sms/sms.processor'

/** Queue processors (SMS delivery, daily session generation + reminders, outbox dispatch, payment expiry). */
@Module({
  imports: [SmsModule, SessionsModule, PaymentsModule, EnrollmentModule, CatalogModule, QueueModule.forFeature()],
  providers: [SmsProcessor, SessionsProcessor, OutboxProcessor],
})
export class WorkerModule {}

/** Standalone worker process root (no HTTP server). */
@Module({ imports: [CoreModule, AuthModule, WorkerModule] })
export class WorkerAppModule {}
