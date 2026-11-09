import { Body, Controller, Get, Patch, Post, Put } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { ClaimInput, DirectionsInput, InstitutionPatch } from './institutions.schemas'
import { InstitutionsService } from './institutions.service'

const HOUR = 3_600_000

/**
 * The institution's own profile (ТЗ 4.2, 9.2 «Учреждение»). Open before approval: until the ministry approves it,
 * this is all the institution can reach; the approved-only sections use `@Approved('institution')`.
 */
@Controller('institutions')
@Roles('INSTITUTION_ADMIN')
export class InstitutionsController {
  constructor(private readonly institutions: InstitutionsService) {}

  /** Limited per account: each attempt shows whether a STIR is in the registry. */
  @Post('claim')
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  claim(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(ClaimInput)) dto: ClaimInput) { return this.institutions.claim(t, a, dto) }

  @Get('me') me(@CurrentActor() a: RequestActor) { return this.institutions.passport(a) }
  @Patch('me') update(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(InstitutionPatch)) dto: InstitutionPatch) { return this.institutions.update(t, a, dto) }
  @Put('me/directions') directions(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(DirectionsInput)) dto: DirectionsInput) { return this.institutions.setDirections(t, a, dto) }
  @Post('me/submit') submit(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.institutions.submit(t, a) }
}
