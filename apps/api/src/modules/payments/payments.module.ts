import { Module, forwardRef } from '@nestjs/common'
import { EnrollmentModule } from '../enrollment/enrollment.module'
import { SmsModule } from '../sms/sms.module'
import { ClickController } from './click/click.controller'
import { ClickService } from './click/click.service'
import { LedgerService } from './ledger.service'
import { OutboxService } from './outbox.service'
import { PaymeController } from './payme/payme.controller'
import { PaymeService } from './payme/payme.service'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'
import { ReconciliationService } from './reconciliation.service'

@Module({
  imports: [forwardRef(() => EnrollmentModule), SmsModule],
  controllers: [PaymentsController, PaymeController, ClickController],
  providers: [PaymentsService, LedgerService, OutboxService, PaymeService, ClickService, ReconciliationService],
  exports: [PaymentsService, LedgerService, OutboxService],
})
export class PaymentsModule {}
