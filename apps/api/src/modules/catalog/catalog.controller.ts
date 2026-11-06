import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator'
import { Throttle } from '@nestjs/throttler'
import { normalizeUzPhone } from '@ilmora/shared'
import { type AuthenticatedRequest, CurrentTenantId, Public } from '../../common/decorators'
import { AppError } from '../../common/errors'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { SiteService } from '../site/site.service'
import { CatalogService } from './catalog.service'

export class InquiryDto {
  @IsOptional() @IsString() @Length(2, 120) centerName?: string
  @IsOptional() @IsString() @Length(2, 120) center?: string

  @IsOptional() @IsString() @Length(2, 80) contactName?: string
  @IsOptional() @IsString() @Length(2, 80) contact?: string

  @IsString() @Length(7, 30) phone!: string

  @IsOptional() @IsString() @Length(0, 120) district?: string
  @IsOptional() @IsString() @Length(0, 100) telegram?: string
  @IsOptional() @IsString() @Length(0, 500) courses?: string
  @IsOptional() @IsString() @Length(0, 2000) message?: string

  @IsOptional() @IsBoolean() consent?: boolean
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

  /** Videos, playlists and resources the caller may open (more for a signed-in student: the bearer token is optional here). */
  @Get('content')
  content(@CurrentTenantId() tenantId: string, @Req() req: AuthenticatedRequest) {
    return this.catalog.publicContent(tenantId, req.actor)
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
    if (dto.consent === false) throw AppError.invalid('consent_required', 'Consent to processing is required')

    const centerName = (dto.centerName || dto.center || '').trim()
    if (!centerName || centerName.length < 2) {
      throw AppError.invalid('invalid_center_name', 'Enter a valid center name (at least 2 characters)')
    }

    const contactName = (dto.contactName || dto.contact || '').trim()
    if (!contactName || contactName.length < 2) {
      throw AppError.invalid('invalid_contact_name', 'Enter a valid contact name (at least 2 characters)')
    }

    const phone = normalizeUzPhone(dto.phone)
    if (!phone.ok) throw AppError.invalid('invalid_phone', 'Enter a valid Uzbek phone number')

    // Prevent accidental duplicate submissions within 5 minutes
    const existing = await this.prisma.client.centerInquiry.findFirst({
      where: {
        tenantId,
        phoneE164: phone.e164,
        centerName,
        createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) {
      return { id: existing.id, receivedAt: existing.createdAt }
    }

    // Build structured details if specific fields were passed separately
    const parts: string[] = []
    if (dto.district?.trim()) parts.push(`District: ${dto.district.trim()}`)
    if (dto.telegram?.trim()) parts.push(`Telegram: ${dto.telegram.trim()}`)
    if (dto.courses?.trim()) parts.push(`Courses: ${dto.courses.trim()}`)
    if (dto.message?.trim()) parts.push(dto.message.trim())
    const fullMessage = parts.join('\n')

    const row = await this.prisma.client.centerInquiry.create({
      data: {
        tenantId,
        centerName,
        contactName,
        phoneE164: phone.e164,
        message: fullMessage,
        consentAt: new Date(),
      },
    })
    return { id: row.id, receivedAt: row.createdAt }
  }
}
