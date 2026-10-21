import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { CoreModule } from './core.module'
import { AppExceptionFilter } from './common/filters/app-exception.filter'
import { AppThrottlerGuard, AuthGuard, RolesGuard } from './common/guards'
import { RequestContextMiddleware } from './common/request-context.middleware'
import { AttendanceModule } from './modules/attendance/attendance.module'
import { AuthModule } from './modules/auth/auth.module'
import { CatalogModule } from './modules/catalog/catalog.module'
import { EnrollmentModule } from './modules/enrollment/enrollment.module'
import { HealthController } from './modules/health/health.controller'
import { ManageModule } from './modules/manage/manage.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { REDIS_OFF } from './infra/queue/queue.module'
import { WorkerModule } from './worker.module'

/** HTTP API composition. With APP_ROLE=all the queue processors run in the same process (development/single host). */
@Module({
  imports: [
    CoreModule,
    AuthModule,
    CatalogModule,
    EnrollmentModule,
    PaymentsModule,
    AttendanceModule,
    ManageModule,
    ...(process.env.APP_ROLE === 'api' || REDIS_OFF ? [] : [WorkerModule]),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*')
  }
}
