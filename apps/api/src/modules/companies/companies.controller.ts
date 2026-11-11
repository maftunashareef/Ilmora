import { Body, Controller, Get, Patch, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { CertificateConfirmInput, CertificateUploadInput, CompanyCreateInput, CompanyPatch } from './companies.schemas'
import { CompaniesService } from './companies.service'

const HOUR = 3_600_000

/**
 * The company's own profile (ТЗ 4.3, 9.2 «Компания»). Open before approval: until the Super Admin approves it, this is
 * all the company can reach; the approved-only sections use `@Approved('company')`.
 */
@Controller('companies')
@Roles('COMPANY_ADMIN')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  /** Limited: each attempt shows whether a STIR is already registered. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  create(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(CompanyCreateInput)) dto: CompanyCreateInput) { return this.companies.create(t, a, dto) }

  @Get('me') me(@CurrentActor() a: RequestActor) { return this.companies.profile(a) }
  /** Limited too (cybersecurity check 9.4): a STIR typed here answers whether it is registered, like `create`. */
  @Patch('me')
  @Throttle({ default: { limit: 30, ttl: HOUR } })
  update(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(CompanyPatch)) dto: CompanyPatch) { return this.companies.update(t, a, dto) }
  @Post('me/submit')
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  submit(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.companies.submit(t, a) }

  @Post('me/certificate/upload-url')
  @Throttle({ default: { limit: 20, ttl: HOUR } })
  certificateUploadUrl(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(CertificateUploadInput)) dto: CertificateUploadInput) { return this.companies.certificateUploadUrl(t, a, dto) }

  @Post('me/certificate')
  @Throttle({ default: { limit: 20, ttl: HOUR } })
  confirmCertificate(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(CertificateConfirmInput)) dto: CertificateConfirmInput) { return this.companies.confirmCertificate(t, a, dto) }
  @Get('me/certificate') certificate(@CurrentActor() a: RequestActor) { return this.companies.certificateLink(a) }
}
