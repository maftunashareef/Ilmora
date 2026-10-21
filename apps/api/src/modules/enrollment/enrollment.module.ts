import { Module, forwardRef } from '@nestjs/common'
import { PaymentsModule } from '../payments/payments.module'
import { EnrollmentController } from './enrollment.controller'
import { SavedController } from './saved.controller'
import { SubscriptionService } from './subscription.service'

@Module({
  imports: [forwardRef(() => PaymentsModule)],
  controllers: [EnrollmentController, SavedController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class EnrollmentModule {}
