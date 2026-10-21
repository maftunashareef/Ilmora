import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { IsBoolean, IsString, Length } from 'class-validator'
import { Throttle } from '@nestjs/throttler'
import { normalizeUzPhone } from '@ilmora/shared'
import { type AuthenticatedRequest, CurrentTenantId, Public } from '../../common/decorators'
import { AppError } from '../../common/errors'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { SiteService } from '../site/site.service'
import { CatalogService } from './catalog.service'

class InquiryDto {
  @IsString() @Length(2, 120) centerName!: string
  @IsString() @Length(2, 80) contactName!: string
  @IsString() @Length(7, 20) phone!: string
  @IsString() @Length(0, 2000) message!: string
  @IsBoolean() consent!: boolean
}

/** Public, cache-friendly read endpoints. Authenticated callers get private items they are entitled to. */
@Controller('public')
@Public()
export class CatalogController {
  constructor(private readonly catalog: CatalogService, private readonly site: SiteService, private readonly prisma: PrismaService) {}

  @Get('site')
  site_(@CurrentTenantId() tenantId: string) {
    return this.site.get(tenantId)
  }

  @Get('catalog')
  catalog_(@CurrentTenantId() tenantId: string) {
    return this.catalog.publicCatalog(tenantId)
  }

  @Get('courses/:key')
  course(@CurrentTenantId() tenantId: string, @Param('key') key: string, @Req() req: AuthenticatedRequest) {
    return this.catalog.courseBySlugOrId(tenantId, key, req.actor)
  }

  @Get('teachers/:key')
  teacher(@CurrentTenantId() tenantId: string, @Param('key') key: string, @Req() req: AuthenticatedRequest) {
    return this.catalog.teacherContent(tenantId, key, req.actor)
  }

  @Get('videos/:id')
  video(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.catalog.contentItem(tenantId, 'video', id, req.actor)
  }

  @Get('playlists/:id')
  playlist(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.catalog.contentItem(tenantId, 'playlist', id, req.actor)
  }

  @Get('resources/:id')
  resource(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.catalog.contentItem(tenantId, 'resource', id, req.actor)
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('inquiries')
  async inquiry(@CurrentTenantId() tenantId: string, @Body() dto: InquiryDto) {
    if (!dto.consent) throw AppError.invalid('consent_required', 'Consent to processing is required')
    const phone = normalizeUzPhone(dto.phone)
    if (!phone.ok) throw AppError.invalid('invalid_phone', 'Enter a valid Uzbek phone number')
    const row = await this.prisma.client.centerInquiry.create({
      data: { tenantId, centerName: dto.centerName.trim(), contactName: dto.contactName.trim(), phoneE164: phone.e164, message: dto.message.trim(), consentAt: new Date() },
    })
    return { id: row.id, receivedAt: row.createdAt }
  }
}
