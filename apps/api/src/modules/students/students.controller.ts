import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { z } from 'zod'
import { ClientInfo, type ClientInfoValue, CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { Approved } from '../../common/registry-access'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { QuestionnaireInput } from './students.schemas'
import { StudentsService } from './students.service'

/** The student's questionnaire (ТЗ 4.1): the contract of apps/web/src/services/questionnaire.ts. */
@Controller('students/me')
@Roles('STUDENT')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get('questionnaire') get(@CurrentActor() a: RequestActor) { return this.students.questionnaire(a) }

  @Put('questionnaire')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  save(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @ClientInfo() ci: ClientInfoValue, @Body(new ZodValidationPipe(QuestionnaireInput)) dto: QuestionnaireInput) {
    return this.students.save(t, a, dto, ci.ip)
  }
}

const StudentsQuery = z.object({ status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED']).optional() })

/** The institution confirms its students (ТЗ 4.1 «Подтверждение учёбы»): name, course, direction, year — no contacts. */
@Controller('institutions/me/students')
@Roles('INSTITUTION_ADMIN')
@Approved('institution')
export class InstitutionStudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get() list(@CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(StudentsQuery)) q: z.infer<typeof StudentsQuery>) { return this.students.institutionStudents(a, q.status) }
  @Post(':id/confirm') confirm(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.students.decideStudy(t, a, id, true) }
  @Post(':id/reject') reject(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.students.decideStudy(t, a, id, false) }
}
