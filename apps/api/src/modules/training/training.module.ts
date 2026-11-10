import { Module } from '@nestjs/common'
import { CompanyTrainingController, InstitutionTrainingController } from './training.controller'
import { TrainingService } from './training.service'

/** Training requests «под обучение» and the institutions' offers (ТЗ 5.2). */
@Module({ controllers: [CompanyTrainingController, InstitutionTrainingController], providers: [TrainingService] })
export class TrainingModule {}
