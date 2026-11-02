import { Module } from '@nestjs/common'
import { CoreModule } from './core.module'
import { QueueModule } from './infra/queue/queue.module'
import { AttendanceModule } from './modules/attendance/attendance.module'
import { AuthModule } from './modules/auth/auth.module'
import { CatalogModule } from './modules/catalog/catalog.module'
import { EnrollmentModule } from './modules/enrollment/enrollment.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { OutboxProcessor } from './modules/payments/outbox.processor'
import { PaymentsModule } from './modules/payments/payments.module'
import { SessionsModule } from './modules/sessions/sessions.module'
import { SessionsProcessor } from './modules/sessions/sessions.processor'
import { SmsModule } from './modules/sms/sms.module'
import { SmsProcessor } from './modules/sms/sms.processor'

/** Queue processors (SMS delivery, daily session generation + reminders, absence marking, outbox dispatch, payment expiry, subscription lifecycle). */
@Module({
  imports: [SmsModule, SessionsModule, PaymentsModule, EnrollmentModule, AttendanceModule, CatalogModule, QueueModule.forFeature()],
  providers: [SmsProcessor, SessionsProcessor, OutboxProcessor],
})
export class WorkerModule {}

/** Standalone worker process root (no HTTP server). */
@Module({ imports: [CoreModule, NotificationsModule, AuthModule, WorkerModule] })
export class WorkerAppModule {}
