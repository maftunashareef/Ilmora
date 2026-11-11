import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { MAX_CART_COURSES } from '@ilmora/shared'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, ValidateIf } from 'class-validator'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { PaymentsService } from '../payments/payments.service'
import { RefundDto, toRefundInput } from './refunds.dto'
import { RefundsService } from './refunds.service'
import { SubscriptionService } from './subscription.service'

class DraftDto {
  /** null clears the package selection; undefined is not valid for this field. */
  @ValidateIf((o: DraftDto) => o.packageId !== null)
  @IsString()
  @Length(1, 80)
  packageId!: string | null
  @IsArray() @ArrayMaxSize(MAX_CART_COURSES) @IsString({ each: true }) groupIds!: string[]
  @IsBoolean() meyosGrant!: boolean
}
class CheckoutDto {
  // Payme only: Click was removed (decision 10.11).
  @IsIn(['PAYME']) provider!: 'PAYME'
  @IsOptional() @IsIn(['uz', 'ru', 'en']) lang?: 'uz' | 'ru' | 'en'
}
class CancelDto {
  @IsOptional() @IsString() @Length(0, 300) reason?: string
}

/** Subscriptions are students' (security review 10.11 №32): a teacher, a center or a company does not take seats. */
@Controller('student/subscription')
@Roles('STUDENT')
export class EnrollmentController {
  constructor(private readonly subscriptions: SubscriptionService, private readonly payments: PaymentsService, private readonly refunds: RefundsService) {}

  @Get()
  overview(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor) {
    return this.subscriptions.overview(tenantId, actor.id)
  }

  @Put('draft')
  draft(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: DraftDto) {
    return this.subscriptions.saveDraft(tenantId, actor.id, { packageId: dto.packageId ?? null, groupIds: dto.groupIds, meyosGrant: dto.meyosGrant })
  }

  /** Creates the pending payment (with seat holds) and returns the provider checkout URL. */
  /**
   * Seats are held for an hour; at most 20 checkouts an hour per student (security review №12) — counted per account,
   * not per address: the 21st student on a center's Wi-Fi could not pay (№75). One student holds one unpaid order at a
   * time anyway (the checkout locks the student's subscriptions; one pending payment per subscription in the database).
   */
  @Post('checkout')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async checkout(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: CheckoutDto) {
    const { payment } = await this.subscriptions.checkout(tenantId, actor.id, dto.provider)
    return this.payments.checkoutLink(payment, dto.provider, dto.lang ?? 'uz')
  }

  @Post('renew')
  async renew(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: CheckoutDto) {
    const { payment } = await this.subscriptions.renew(tenantId, actor.id, dto.provider)
    return this.payments.checkoutLink(payment, dto.provider, dto.lang ?? 'uz')
  }

  /** «Cancel»: a paid subscription is refused whole and its refund requests are filed (offer 6.3–6.6, №42). */
  @Post('cancel')
  cancel(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: CancelDto) {
    return this.refunds.cancelSubscription(tenantId, actor.id, dto.reason)
  }

  // ── refund requests (offer 6.3–6.6, appendix 2) ──
  @Get('refunds')
  myRefunds(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor) {
    return this.refunds.listMine(tenantId, actor.id)
  }

  /** What the request would return, before it is filed. */
  @Post('refunds/quote')
  quoteRefund(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: RefundDto) {
    return this.refunds.quote(tenantId, actor.id, toRefundInput(dto))
  }

  @Post('refunds')
  requestRefund(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: RefundDto) {
    return this.refunds.refuse(tenantId, actor.id, toRefundInput(dto), { source: 'CABINET', actorId: actor.id })
  }

  @Post('refunds/:id/withdraw')
  withdrawRefund(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Param('id') id: string) {
    return this.refunds.withdraw(tenantId, actor.id, id)
  }
}
