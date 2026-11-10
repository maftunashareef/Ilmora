import { Module, forwardRef } from '@nestjs/common'
import { EnrollmentModule } from '../enrollment/enrollment.module'
import { SmsModule } from '../sms/sms.module'
import { LedgerService } from './ledger.service'
import { OutboxService } from './outbox.service'
import { PaymeController } from './payme/payme.controller'
import { PaymeService } from './payme/payme.service'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'
import { ReconciliationService } from './reconciliation.service'

@Module({
  imports: [forwardRef(() => EnrollmentModule), SmsModule],
  controllers: [PaymentsController, PaymeController],
  providers: [PaymentsService, LedgerService, OutboxService, PaymeService, ReconciliationService],
  exports: [PaymentsService, LedgerService, OutboxService],
})
export class PaymentsModule {}
