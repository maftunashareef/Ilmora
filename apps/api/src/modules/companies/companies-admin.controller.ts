import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AdminCompaniesQuery, DecideInput, RejectInput, ReviewRejectInput } from '../institutions/institutions-admin.controller'
import { CompanyReviewService } from './company-review.service'

/** Review of company profiles — the Super Admin only (ТЗ 4.3, 9.2 «Super Admin»). Every decision and certificate link is audited. */
@Controller('admin/companies')
@Roles('PLATFORM_ADMIN')
export class CompaniesAdminController {
  constructor(private readonly review: CompanyReviewService) {}

  /** All companies — search by STIR, name, status (issue #50). */
  @Get() search(@Query(new ZodValidationPipe(AdminCompaniesQuery)) q: AdminCompaniesQuery) { return this.review.search(q) }
  @Get('reviews') queue() { return this.review.queue() }
  @Get(':id') detail(@Param('id') id: string) { return this.review.detail(id) }
  @Get(':id/certificate') certificate(@Param('id') id: string) { return this.review.certificate(id) }
  @Post(':id/approve') approve(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(DecideInput)) dto: DecideInput) { return this.review.approve(t, a, id, dto.submittedAt) }
  @Post(':id/block') block(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(RejectInput)) dto: RejectInput) { return this.review.setBlocked(t, a, id, true, dto.reason) }
  @Post(':id/unblock') unblock(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.review.setBlocked(t, a, id, false) }
  @Post(':id/release') release(@CurrentTenantId() t: string, @Param('id') id: string, @Body(new ZodValidationPipe(RejectInput)) dto: RejectInput) { return this.review.release(t, id, dto.reason) }
  @Post(':id/reject') reject(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(ReviewRejectInput)) dto: ReviewRejectInput) { return this.review.reject(t, a, id, dto.reason, dto.submittedAt) }
}
