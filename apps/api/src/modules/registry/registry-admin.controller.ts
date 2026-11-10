import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AdminDirectionsQuery, DirectionPatch, IndustryInput, IndustryPatch, MergeInput, StudentInstitutionsQuery } from './registry-admin.schemas'
import { RegistryAdminService } from './registry-admin.service'

/** The Super Admin's reference data (ТЗ 9.2): industries, directions, institutions added by students. All audited. */
@Controller('admin')
@Roles('PLATFORM_ADMIN')
export class RegistryAdminController {
  constructor(private readonly admin: RegistryAdminService) {}

  @Get('industries') industries() { return this.admin.industries() }
  @Post('industries') createIndustry(@CurrentTenantId() t: string, @Body(new ZodValidationPipe(IndustryInput)) dto: IndustryInput) { return this.admin.createIndustry(t, dto) }
  @Patch('industries/:id') updateIndustry(@Param('id') id: string, @Body(new ZodValidationPipe(IndustryPatch)) dto: IndustryPatch) { return this.admin.updateIndustry(id, dto) }

  @Get('directions') directions(@Query(new ZodValidationPipe(AdminDirectionsQuery)) q: AdminDirectionsQuery) { return this.admin.directions(q) }
  @Patch('directions/:id') updateDirection(@CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(DirectionPatch)) dto: DirectionPatch) { return this.admin.updateDirection(a, id, dto) }
  @Post('directions/:id/merge') mergeDirection(@CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(MergeInput)) dto: MergeInput) { return this.admin.mergeDirection(a, id, dto.intoId) }

  @Get('registry/student-institutions') studentInstitutions(@Query(new ZodValidationPipe(StudentInstitutionsQuery)) q: StudentInstitutionsQuery) { return this.admin.studentInstitutions(q) }
  @Post('institutions/:id/merge') mergeInstitution(@CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(MergeInput)) dto: MergeInput) { return this.admin.mergeInstitution(a, id, dto.intoId) }
}
