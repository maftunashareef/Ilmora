import { Module } from '@nestjs/common'
import { InstitutionsController } from './institutions.controller'
import { InstitutionsService } from './institutions.service'

/** Registry: the institution's own profile — claim by STIR, passport, directions, submit (ТЗ 4.2). */
@Module({
  controllers: [InstitutionsController],
  providers: [InstitutionsService],
  exports: [InstitutionsService],
})
export class InstitutionsModule {}
