import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { Approved } from '../../common/registry-access'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { CompanyStudentsService } from './company-students.service'
import { AnnouncementInput, AnnouncementPatch, AnnouncementsQuery, CompanyStudentsPageQuery, CompanyStudentsQuery, ExclusionInput, InviteInput, ResponseInput } from './graduates.schemas'
import { GraduatesService } from './graduates.service'

const DAY = 86_400_000

/** The institution's graduation announcements and the companies' answers (ТЗ 5.1). Approved institutions only. */
@Controller('institutions/me')
@Roles('INSTITUTION_ADMIN')
@Approved('institution')
export class InstitutionAnnouncementsController {
  constructor(private readonly graduates: GraduatesService) {}

  @Get('announcements') list(@CurrentActor() a: RequestActor) { return this.graduates.list(a) }
  @Post('announcements') create(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(AnnouncementInput)) dto: AnnouncementInput) { return this.graduates.create(t, a, dto) }
  @Get('announcements/:id') one(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.graduates.get(a, id) }
  @Patch('announcements/:id') update(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(AnnouncementPatch)) dto: AnnouncementPatch) { return this.graduates.updateLines(t, a, id, dto) }
  @Post('announcements/:id/publish') publish(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.graduates.publish(t, a, id) }
  @Post('announcements/:id/close') close(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.graduates.close(a, id) }
  @Post('announcements/:id/exclusions') exclude(@CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(ExclusionInput)) dto: { studentId: string }) { return this.graduates.setExcluded(a, id, dto.studentId, true) }
  @Delete('announcements/:id/exclusions/:studentId') include(@CurrentActor() a: RequestActor, @Param('id') id: string, @Param('studentId') studentId: string) { return this.graduates.setExcluded(a, id, studentId, false) }
  @Get('announcements/:id/responses') responses(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.graduates.responses(a, id) }
  @Post('announcement-responses/:id/accept') accept(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.graduates.decideResponse(t, a, id, true) }
  @Post('announcement-responses/:id/decline') decline(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.graduates.decideResponse(t, a, id, false) }
}

/** Announcements as companies see them: lines of their industries, graduates without contacts, answer, invite (ТЗ 5.1). */
@Controller()
@Roles('COMPANY_ADMIN')
@Approved('company')
export class CompanyAnnouncementsController {
  constructor(private readonly graduates: GraduatesService) {}

  @Get('announcements') list(@CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(AnnouncementsQuery)) q: AnnouncementsQuery) { return this.graduates.companyList(a, q) }
  @Get('announcements/:id') one(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.graduates.companyGet(a, id) }

  @Post('announcements/:id/responses')
  @Throttle({ default: { limit: 50, ttl: DAY } })
  respond(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(ResponseInput)) dto: ResponseInput) { return this.graduates.respond(t, a, id, dto) }

  /** ~50 a day: a company does not flood students with requests (ТЗ 9.4 «Лимиты»). */
  @Post('graduates/:cardId/invite')
  @Throttle({ default: { limit: 50, ttl: DAY } })
  invite(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('cardId') cardId: string, @Body(new ZodValidationPipe(InviteInput)) dto: InviteInput) { return this.graduates.invite(t, a, cardId, dto.announcementId) }
}

/**
 * The company's «Студенты» section (ТЗ «Студенты у компании, Вакансии у учреждения», 2): institutions with matching
 * students, one institution's cards a page at a time, «Запросить контакты». Approved, unblocked companies only; nothing
 * can be downloaded, a page holds STUDENTS_PAGE_SIZE cards.
 */
@Controller('companies/me/students')
@Roles('COMPANY_ADMIN')
@Approved('company')
export class CompanyStudentsController {
  constructor(private readonly students: CompanyStudentsService) {}

  @Get('institutions') blocks(@CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(CompanyStudentsQuery)) q: CompanyStudentsQuery) { return this.students.blocks(a, q) }

  @Get('institutions/:institutionId')
  page(@CurrentActor() a: RequestActor, @Param('institutionId') institutionId: string, @Query(new ZodValidationPipe(CompanyStudentsPageQuery)) q: CompanyStudentsPageQuery) {
    const { page, ...filters } = q
    return this.students.page(a, institutionId, filters, page)
  }

  /** Counted with «Пригласить» and «Заинтересованы» in the company's daily limit (in the database). */
  @Post('institutions/:institutionId/:cardId/request')
  @Throttle({ default: { limit: 50, ttl: DAY } })
  request(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('institutionId') institutionId: string, @Param('cardId') cardId: string) { return this.students.request(t, a, institutionId, cardId) }
}
