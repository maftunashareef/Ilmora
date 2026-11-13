import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { z } from 'zod'
import { ClientInfo, type ClientInfoValue, CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { Approved } from '../../common/registry-access'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { CertificateInput, CertificatePatch, CertificateUploadInput } from './certificates.schemas'
import { CertificatesService } from './certificates.service'
import { ConsentKindParam, QuestionnaireInput } from './students.schemas'
import { StudentsService } from './students.service'

/** The student's questionnaire (ТЗ 4.1, the contract of apps/web/src/services/questionnaire.ts), certificates and courses (ТЗ 5.5). */
@Controller('students/me')
@Roles('STUDENT')
export class StudentsController {
  constructor(private readonly students: StudentsService, private readonly certificates: CertificatesService) {}

  @Get('questionnaire') get(@CurrentActor() a: RequestActor) { return this.students.questionnaire(a) }

  @Put('questionnaire')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  save(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @ClientInfo() ci: ClientInfoValue, @Body(new ZodValidationPipe(QuestionnaireInput)) dto: QuestionnaireInput) {
    return this.students.save(t, a, dto, ci.ip)
  }

  /** The consent journal: what is in force and the history (ТЗ 8). */
  @Get('consents') consents(@CurrentActor() a: RequestActor) { return this.students.consents(a) }

  /** «Дать согласие» / «Отозвать» — each its own action, apart from the questionnaire; both answer with the journal. */
  @Post('consents/:kind/give')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  giveConsent(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @ClientInfo() ci: ClientInfoValue, @Param('kind', new ZodValidationPipe(ConsentKindParam)) kind: ConsentKindParam) {
    return this.students.giveConsent(t, a, kind, ci.ip)
  }

  /** Taking a consent back never depends on the questionnaire and is not rate-limited beyond the API's general limit. */
  @Post('consents/:kind/revoke')
  revokeConsent(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('kind', new ZodValidationPipe(ConsentKindParam)) kind: ConsentKindParam) {
    return this.students.revokeConsent(t, a, kind)
  }

  @Get('certificates') certificatesList(@CurrentActor() a: RequestActor) { return this.certificates.list(a) }

  @Post('certificates/upload-url')
  @Throttle({ default: { limit: 40, ttl: 3_600_000 } })
  certificateUploadUrl(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(CertificateUploadInput)) dto: CertificateUploadInput) { return this.certificates.uploadUrl(t, a, dto) }

  @Post('certificates') certificateAdd(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(CertificateInput)) dto: CertificateInput) { return this.certificates.add(t, a, dto) }
  @Patch('certificates/:id') certificateUpdate(@CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(CertificatePatch)) dto: CertificatePatch) { return this.certificates.update(a, id, dto) }
  @Delete('certificates/:id') @HttpCode(204) async certificateRemove(@CurrentActor() a: RequestActor, @Param('id') id: string) { await this.certificates.remove(a, id) }
  @Get('certificates/:id/file') certificateFile(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.certificates.link(a, id) }

  /** «Курсы в ILMORA»: subscriptions to learning centers with attendance. */
  @Get('courses') courses(@CurrentActor() a: RequestActor) { return this.certificates.courses(a) }
}

const StudentsQuery = z.object({ status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED']).optional() })
/**
 * What the institution saw in the list (cybersecurity check 9.4, Н-8): the direction and the year of graduation. If
 * the student changed them since, the decision is refused with 409 `study_changed` — not applied to data nobody saw.
 */
export const StudySeenInput = z.object({ directionId: z.string().min(1).max(64).nullable(), graduationYear: z.number().int().min(1990).max(2100).nullable() }).strict()
export type StudySeenInput = z.infer<typeof StudySeenInput>

/** The institution confirms its students (ТЗ 4.1 «Подтверждение учёбы»): name, course, direction, year — no contacts. */
@Controller('institutions/me/students')
@Roles('INSTITUTION_ADMIN')
@Approved('institution')
export class InstitutionStudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get() list(@CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(StudentsQuery)) q: z.infer<typeof StudentsQuery>) { return this.students.institutionStudents(a, q.status) }
  @Post(':id/confirm') confirm(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(StudySeenInput)) seen: StudySeenInput) { return this.students.decideStudy(t, a, id, true, seen) }
  @Post(':id/reject') reject(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(StudySeenInput)) seen: StudySeenInput) { return this.students.decideStudy(t, a, id, false, seen) }
}
