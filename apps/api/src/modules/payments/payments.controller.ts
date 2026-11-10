import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { CurrentActor, CurrentTenantId, Public, Roles } from '../../common/decorators'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { PaymentsService } from './payments.service'
import { ReconciliationService } from './reconciliation.service'

class ReconQuery {
  @IsOptional() @IsIn(['PAYME', 'CLICK', 'MANUAL']) provider?: 'PAYME' | 'CLICK' | 'MANUAL'
  @IsOptional() @IsIn(['CREATED', 'PERFORMED', 'CANCELLED', 'FAILED']) status?: 'CREATED' | 'PERFORMED' | 'CANCELLED' | 'FAILED'
  // A date that does not parse is a 400, not a 500 from the database (security review 10.11 №43).
  @IsOptional() @IsDateString({ strict: true }) from?: string
  @IsOptional() @IsDateString({ strict: true }) to?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(200) pageSize?: number
}
class ManualSettleDto {
  @IsString() @Length(3, 200) reference!: string
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService, private readonly reconciliation: ReconciliationService) {}

  @Public()
  @Get('payments/providers')
  providers() {
    return this.payments.providersAvailable()
  }

  @Get('payments/:id')
  status(@Param('id') id: string, @CurrentActor() actor: RequestActor) {
    return this.payments.statusForStudent(id, actor.id)
  }

  // ── finance ──
  @Roles('FINANCE_ADMIN')
  @Get('admin/finance/reconciliation')
  reconcile(@CurrentTenantId() tenantId: string, @Query() q: ReconQuery) {
    return this.reconciliation.list(tenantId, { provider: q.provider, status: q.status, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, page: q.page, pageSize: q.pageSize })
  }

  @Roles('FINANCE_ADMIN')
  @Get('admin/finance/balances')
  balances(@CurrentTenantId() tenantId: string) {
    return this.reconciliation.balances(tenantId)
  }

  @Roles('FINANCE_ADMIN')
  @Post('admin/finance/transactions/:id/verify')
  verify(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.reconciliation.verifyWithProvider(tenantId, id)
  }

  @Roles('FINANCE_ADMIN')
  @Post('admin/finance/payments/:id/manual-settle')
  manualSettle(@Param('id') id: string, @CurrentActor() actor: RequestActor, @Body() dto: ManualSettleDto) {
    return this.payments.manualSettle(id, actor.id, dto.reference)
  }
}
