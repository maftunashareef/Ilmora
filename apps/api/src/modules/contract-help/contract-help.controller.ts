import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ClientInfo, type ClientInfoValue, CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { Approved } from '../../common/registry-access'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { ContractHelpInput, ContractHelpQuery, SignedInput } from './contract-help.schemas'
import { ContractHelpService } from './contract-help.service'

const DAY = 86_400_000

/** The student's request for help with the contract fee (ТЗ 5.3). */
@Controller('students/me/contract-help')
@Roles('STUDENT')
export class StudentContractHelpController {
  constructor(private readonly help: ContractHelpService) {}

  @Get() mine(@CurrentActor() a: RequestActor) { return this.help.mine(a) }

  @Post()
  @Throttle({ default: { limit: 10, ttl: DAY } })
  create(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @ClientInfo() ci: ClientInfoValue, @Body(new ZodValidationPipe(ContractHelpInput)) dto: ContractHelpInput) { return this.help.create(t, a, dto, ci.ip) }

  @Delete() withdraw(@CurrentActor() a: RequestActor) { return this.help.withdraw(a) }
  @Post('signed') signed(@CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(SignedInput)) dto: SignedInput) { return this.help.signed(a, dto.companyId) }
}

/** Anonymised cards for approved companies of the student's industry; «Заинтересованы» asks for the contacts (ТЗ 5.3). */
@Controller('contract-help')
@Roles('COMPANY_ADMIN')
@Approved('company')
export class CompanyContractHelpController {
  constructor(private readonly help: ContractHelpService) {}

  @Get() feed(@CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(ContractHelpQuery)) q: ContractHelpQuery) { return this.help.feed(a, q) }
  @Get(':id') one(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.help.card(a, id) }

  /** ~50 a day, shared in spirit with graduate invitations (ТЗ 9.4 «Лимиты»). */
  @Post(':id/interest')
  @Throttle({ default: { limit: 50, ttl: DAY } })
  interest(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.help.interest(t, a, id) }
}
