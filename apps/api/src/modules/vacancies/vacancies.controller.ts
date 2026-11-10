import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { Approved } from '../../common/registry-access'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { ApplicationStatusInput, ApplyInput, VacanciesQuery, VacancyInput, VacancyPatch } from './vacancies.schemas'
import { VacanciesService } from './vacancies.service'

const DAY = 86_400_000

/** The company's practice and internship vacancies and the applications with full cards (ТЗ 5.4). */
@Controller('companies/me')
@Roles('COMPANY_ADMIN')
@Approved('company')
export class CompanyVacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  @Get('vacancies') list(@CurrentActor() a: RequestActor) { return this.vacancies.companyList(a) }

  @Post('vacancies')
  @Throttle({ default: { limit: 30, ttl: DAY } })
  create(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(VacancyInput)) dto: VacancyInput) { return this.vacancies.create(t, a, dto) }

  @Get('vacancies/:id') one(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.vacancies.companyGet(a, id) }
  @Patch('vacancies/:id') update(@CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(VacancyPatch)) dto: VacancyPatch) { return this.vacancies.update(a, id, dto) }
  @Post('vacancies/:id/close') close(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.vacancies.close(a, id) }
  @Get('vacancies/:id/applications') applications(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.vacancies.applications(t, a, id) }

  @Get('vacancy-applications/:id') application(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.vacancies.application(t, a, id) }

  @Post('vacancy-applications/:id/status')
  status(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(ApplicationStatusInput)) dto: ApplicationStatusInput) {
    return this.vacancies.setStatus(t, a, id, dto.status)
  }

  @Get('vacancy-applications/:id/certificates/:certId/file') file(@CurrentActor() a: RequestActor, @Param('id') id: string, @Param('certId') certId: string) { return this.vacancies.certificateLink(a, id, certId) }
}

/** Practice and internships for students: the list, one vacancy, «Откликнуться», my applications (ТЗ 5.4). */
@Controller()
@Roles('STUDENT')
export class StudentVacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  @Get('vacancies') list(@CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(VacanciesQuery)) q: VacanciesQuery) { return this.vacancies.list(a, q) }
  @Get('vacancies/:id') one(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.vacancies.get(a, id) }

  @Post('vacancies/:id/apply')
  @Throttle({ default: { limit: 30, ttl: DAY } })
  apply(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(ApplyInput)) dto: ApplyInput) { return this.vacancies.apply(t, a, id, dto) }

  @Get('students/me/applications') mine(@CurrentActor() a: RequestActor) { return this.vacancies.myApplications(a) }
}
