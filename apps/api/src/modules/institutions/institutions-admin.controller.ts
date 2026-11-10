import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { hasMarkup } from '@ilmora/shared'
import { z } from 'zod'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { InstitutionReviewService } from './institution-review.service'

/** The reason is shown to the institution: why, and what to fix. */
export const RejectInput = z
  .object({ reason: z.string().transform((s) => s.normalize('NFC').trim()).pipe(z.string().min(5).max(1000).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' })) })
  .strict()
export type RejectInput = z.infer<typeof RejectInput>

/**
 * Review of institution profiles. Only the Super Admin (PLATFORM_ADMIN) decides — decision of 10.11; the ministry does
 * not reach these routes. Every decision is audited and the institution is notified.
 */
@Controller('admin/institutions')
@Roles('PLATFORM_ADMIN')
export class InstitutionsAdminController {
  constructor(private readonly review: InstitutionReviewService) {}

  @Get('reviews') queue() { return this.review.queue() }
  @Get(':id') detail(@Param('id') id: string) { return this.review.detail(id) }
  @Post(':id/approve') approve(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.review.approve(t, a, id) }
  @Post(':id/block') block(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(RejectInput)) dto: RejectInput) { return this.review.setBlocked(t, a, id, true, dto.reason) }
  @Post(':id/unblock') unblock(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.review.setBlocked(t, a, id, false) }
  @Post(':id/release') release(@CurrentTenantId() t: string, @Param('id') id: string, @Body(new ZodValidationPipe(RejectInput)) dto: RejectInput) { return this.review.release(t, id, dto.reason) }
  @Post(':id/reject') reject(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(RejectInput)) dto: RejectInput) { return this.review.reject(t, a, id, dto.reason) }
}
