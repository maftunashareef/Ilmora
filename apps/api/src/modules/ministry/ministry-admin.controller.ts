import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { MinistryAccountsService } from './ministry-accounts.service'
import { MinistryAccountInput, MinistryAccountPatch } from './ministry.schemas'

/** Ministry accounts and second-factor resets — the Super Admin only (ТЗ 4.4, 9.2 «Super Admin»). Every change is audited. */
@Controller('admin')
@Roles('PLATFORM_ADMIN')
export class MinistryAdminController {
  constructor(private readonly accounts: MinistryAccountsService) {}

  @Get('ministry-accounts') list() { return this.accounts.list() }
  @Post('ministry-accounts') create(@CurrentTenantId() t: string, @Body(new ZodValidationPipe(MinistryAccountInput)) dto: MinistryAccountInput) { return this.accounts.create(t, dto) }
  @Patch('ministry-accounts/:id') update(@Param('id') id: string, @Body(new ZodValidationPipe(MinistryAccountPatch)) dto: MinistryAccountPatch) { return this.accounts.update(id, dto) }
  @Post('ministry-accounts/:id/disable') disable(@CurrentTenantId() t: string, @Param('id') id: string) { return this.accounts.setActive(t, id, false) }
  @Post('ministry-accounts/:id/enable') enable(@CurrentTenantId() t: string, @Param('id') id: string) { return this.accounts.setActive(t, id, true) }
  @Post('ministry-accounts/:id/reset-password') resetPassword(@CurrentTenantId() t: string, @Param('id') id: string) { return this.accounts.resetPassword(t, id) }

  /** Lost phone: unlink the authenticator app of a ministry account or of another Super Admin. */
  /** «Сбросить пароль» for any account but a Super Admin; the temporary password is shown once. */
  @Post('accounts/:id/reset-password') resetAccountPassword(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.accounts.resetAccountPassword(t, a, id) }

  @Post('accounts/:id/reset-second-factor')
  async resetSecondFactor(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) {
    await this.accounts.resetSecondFactor(t, a, id)
    return { ok: true }
  }
}
