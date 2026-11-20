import { Body, Controller, Get, Put } from '@nestjs/common'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { CommissionInput } from './manage.schemas'
import { ManageService } from './manage.service'

/**
 * ILMORA's commission (ТЗ 2026-11-18, 9.5): one for every center, read and changed by the Super Admin only. Centers see it
 * in their course form (GET /center/courses → `pricing`) and cannot change it; no other body carries a commission.
 */
@Controller('admin/pricing')
@Roles('PLATFORM_ADMIN')
export class AdminPricingController {
  constructor(private readonly manage: ManageService) {}

  @Get() get(@CurrentTenantId() t: string) { return this.manage.pricing(t) }
  @Put() set(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(CommissionInput)) dto: CommissionInput) { return this.manage.setCommission(t, a, dto.commissionPercent) }
}
