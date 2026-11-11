import { Module, forwardRef } from '@nestjs/common'
import { PaymentsModule } from '../payments/payments.module'
import { EnrollmentController } from './enrollment.controller'
import { RefundsAdminController } from './refunds-admin.controller'
import { RefundsService } from './refunds.service'
import { SavedController } from './saved.controller'
import { SubscriptionService } from './subscription.service'

@Module({
  imports: [forwardRef(() => PaymentsModule)],
  controllers: [EnrollmentController, SavedController, RefundsAdminController],
  providers: [SubscriptionService, RefundsService],
  exports: [SubscriptionService, RefundsService],
})
export class EnrollmentModule {}
