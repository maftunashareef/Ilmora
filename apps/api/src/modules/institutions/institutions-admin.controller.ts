import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
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

/**
 * The review decision may carry `submittedAt` of the change the reviewer looked at (review 11.11): if the
 * representative saved another change since, the decision is refused with 409 `review_changed` instead of approving
 * values nobody has seen. Without it the decision still applies only to the change as it was when read.
 */
const SubmittedAt = z.string().datetime({ offset: true }).optional()
export const DecideInput = z.object({ submittedAt: SubmittedAt }).strict().default({})
export type DecideInput = z.infer<typeof DecideInput>
export const ReviewRejectInput = RejectInput.extend({ submittedAt: SubmittedAt }).strict()
export type ReviewRejectInput = z.infer<typeof ReviewRejectInput>
export type RejectInput = z.infer<typeof RejectInput>

const page = z.coerce.number().int().min(1).max(10_000).default(1)
const stir = z.string().trim().regex(/^\d{9}$/)
/** The Super Admin's search over all records (issue #50). */
export const AdminInstitutionsQuery = z.object({
  stir: stir.optional(),
  q: z.string().trim().max(200).optional(),
  status: z.enum(['UNCLAIMED', 'DRAFT', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
  type: z.enum(['TECHNIKUM', 'COLLEGE', 'LYCEUM', 'SCHOOL', 'UNIVERSITY', 'TRAINING_CENTER']).optional(),
  regionId: z.string().trim().max(64).optional(),
  page,
})
export type AdminInstitutionsQuery = z.infer<typeof AdminInstitutionsQuery>
export const AdminCompaniesQuery = z.object({ stir: stir.optional(), q: z.string().trim().max(200).optional(), status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']).optional(), page })
export type AdminCompaniesQuery = z.infer<typeof AdminCompaniesQuery>

/**
 * Review of institution profiles. Only the Super Admin (PLATFORM_ADMIN) decides — decision of 10.11; the ministry does
 * not reach these routes. Every decision is audited and the institution is notified.
 */
@Controller('admin/institutions')
@Roles('PLATFORM_ADMIN')
export class InstitutionsAdminController {
  constructor(private readonly review: InstitutionReviewService) {}

  /** All records — search by STIR, name, status, type, region (issue #50). */
  @Get() search(@Query(new ZodValidationPipe(AdminInstitutionsQuery)) q: AdminInstitutionsQuery) { return this.review.search(q) }
  @Get('reviews') queue() { return this.review.queue() }
  @Get(':id') detail(@Param('id') id: string) { return this.review.detail(id) }
  @Post(':id/approve') approve(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(DecideInput)) dto: DecideInput) { return this.review.approve(t, a, id, dto.submittedAt) }
  @Post(':id/block') block(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(RejectInput)) dto: RejectInput) { return this.review.setBlocked(t, a, id, true, dto.reason) }
  @Post(':id/unblock') unblock(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.review.setBlocked(t, a, id, false) }
  @Post(':id/release') release(@CurrentTenantId() t: string, @Param('id') id: string, @Body(new ZodValidationPipe(RejectInput)) dto: RejectInput) { return this.review.release(t, id, dto.reason) }
  @Post(':id/reject') reject(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(ReviewRejectInput)) dto: ReviewRejectInput) { return this.review.reject(t, a, id, dto.reason, dto.submittedAt) }
}
