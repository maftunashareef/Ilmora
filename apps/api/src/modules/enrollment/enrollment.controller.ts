import { Body, Controller, Get, Post, Put } from '@nestjs/common'
import { MAX_CART_COURSES } from '@ilmora/shared'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, ValidateIf } from 'class-validator'
import { AuthThrottle, CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { PaymentsService } from '../payments/payments.service'
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
  constructor(private readonly subscriptions: SubscriptionService, private readonly payments: PaymentsService) {}

  @Get()
  overview(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor) {
    return this.subscriptions.overview(tenantId, actor.id)
  }

  @Put('draft')
  draft(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: DraftDto) {
    return this.subscriptions.saveDraft(tenantId, actor.id, { packageId: dto.packageId ?? null, groupIds: dto.groupIds, meyosGrant: dto.meyosGrant })
  }

  /** Creates the pending payment (with seat holds) and returns the provider checkout URL. */
  /** Seats are held for an hour; at most 20 checkouts an hour from one address (security review №12). */
  @Post('checkout')
  @AuthThrottle(20, 3_600_000)
  async checkout(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: CheckoutDto) {
    const { payment } = await this.subscriptions.checkout(tenantId, actor.id, dto.provider)
    return this.payments.checkoutLink(payment, dto.provider, dto.lang ?? 'uz')
  }

  @Post('renew')
  async renew(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: CheckoutDto) {
    const { payment } = await this.subscriptions.renew(tenantId, actor.id, dto.provider)
    return this.payments.checkoutLink(payment, dto.provider, dto.lang ?? 'uz')
  }

  @Post('cancel')
  cancel(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: CancelDto) {
    return this.subscriptions.cancel(tenantId, actor.id, dto.reason)
  }
}
