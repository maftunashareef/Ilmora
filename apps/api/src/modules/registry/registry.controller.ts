import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentActor, Roles } from '../../common/decorators'
import { REGISTRY_ROLES } from '../../common/registry-access'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { DirectionInput, DirectionsQuery, DistrictsQuery, InstitutionsQuery, StudentInstitutionInput } from './registry.schemas'
import { RegistryService } from './registry.service'

const DAY = 86_400_000

/**
 * Registry reference data (ТЗ 9.2 «Справочники»). Reading needs a signed-in account (any role); adding to the shared
 * dictionaries is limited per account and per day (ТЗ 9.4 «Лимиты запросов»).
 */
@Controller('registry')
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  @Get('industries') industries() { return this.registry.industries() }
  @Get('regions') regions() { return this.registry.regions() }
  @Get('districts') districts(@Query(new ZodValidationPipe(DistrictsQuery)) q: DistrictsQuery) { return this.registry.districts(q.regionId) }

  @Get('directions') directions(@Query(new ZodValidationPipe(DirectionsQuery)) q: DirectionsQuery) { return this.registry.suggestDirections(q) }

  /** Institutions fill their directions before approval, so no `@Approved` here. */
  @Post('directions')
  @Roles('STUDENT', REGISTRY_ROLES.INSTITUTION_ADMIN, REGISTRY_ROLES.COMPANY_ADMIN)
  @Throttle({ default: { limit: 20, ttl: DAY } })
  addDirection(@CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(DirectionInput)) dto: DirectionInput) { return this.registry.addDirection(a, dto) }

  @Get('institutions') institutions(@Query(new ZodValidationPipe(InstitutionsQuery)) q: InstitutionsQuery) { return this.registry.searchInstitutions(q) }

  @Post('institutions')
  @Roles('STUDENT')
  @Throttle({ default: { limit: 3, ttl: DAY } })
  addInstitution(@CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(StudentInstitutionInput)) dto: StudentInstitutionInput) { return this.registry.addStudentInstitution(a, dto) }
}
