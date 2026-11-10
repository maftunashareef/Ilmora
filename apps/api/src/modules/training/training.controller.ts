import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { Approved } from '../../common/registry-access'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { IncomingQuery, TrainingOfferInput, TrainingRequestInput, TrainingRequestPatch } from './training.schemas'
import { TrainingService } from './training.service'

const DAY = 86_400_000

/** A company's training requests «под обучение» and its decisions on the offers (ТЗ 5.2). Approved companies only. */
@Controller('companies/me')
@Roles('COMPANY_ADMIN')
@Approved('company')
export class CompanyTrainingController {
  constructor(private readonly training: TrainingService) {}

  @Post('training-requests')
  @Throttle({ default: { limit: 30, ttl: DAY } })
  create(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(TrainingRequestInput)) dto: TrainingRequestInput) { return this.training.create(t, a, dto) }

  @Get('training-requests') list(@CurrentActor() a: RequestActor) { return this.training.listOwn(a) }
  @Get('training-requests/:id') one(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.training.getOwn(a, id) }
  @Patch('training-requests/:id') update(@CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(TrainingRequestPatch)) dto: TrainingRequestPatch) { return this.training.update(a, id, dto) }
  @Post('training-requests/:id/close') close(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.training.close(a, id) }
  @Post('offers/:id/accept') accept(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.training.decide(t, a, id, true) }
  @Post('offers/:id/decline') decline(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.training.decide(t, a, id, false) }
}

/** Requests an institution can answer, and its offers (ТЗ 5.2). Approved institutions only. */
@Controller()
@Roles('INSTITUTION_ADMIN')
@Approved('institution')
export class InstitutionTrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get('training-requests') incoming(@CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(IncomingQuery)) q: IncomingQuery) { return this.training.incoming(a, q) }
  @Get('training-requests/:id') one(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.training.incomingOne(a, id) }

  @Post('training-requests/:id/offers')
  @Throttle({ default: { limit: 50, ttl: DAY } })
  offer(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(new ZodValidationPipe(TrainingOfferInput)) dto: TrainingOfferInput) { return this.training.offer(t, a, id, dto) }

  @Get('institutions/me/offers') offers(@CurrentActor() a: RequestActor) { return this.training.myOffersList(a) }
  @Post('institutions/me/offers/:id/withdraw') withdraw(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.training.withdraw(a, id) }
}
