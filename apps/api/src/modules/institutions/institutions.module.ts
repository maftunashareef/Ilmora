import { Module } from '@nestjs/common'
import { InstitutionReviewService } from './institution-review.service'
import { InstitutionsAdminController } from './institutions-admin.controller'
import { InstitutionsController } from './institutions.controller'
import { InstitutionsService } from './institutions.service'

/** Registry: the institution's own profile — claim by STIR, passport, directions, submit (ТЗ 4.2) — and its review by the Super Admin. */
@Module({
  controllers: [InstitutionsController, InstitutionsAdminController],
  providers: [InstitutionsService, InstitutionReviewService],
  exports: [InstitutionsService],
})
export class InstitutionsModule {}
