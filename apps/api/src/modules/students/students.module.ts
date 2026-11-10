import { Module } from '@nestjs/common'
import { RegistryModule } from '../registry/registry.module'
import { InstitutionStudentsController, StudentsController } from './students.controller'
import { StudentsService } from './students.service'

/** Students of the registry: the questionnaire (ТЗ 4.1) and the institution's confirmation of study. */
@Module({ imports: [RegistryModule], controllers: [StudentsController, InstitutionStudentsController], providers: [StudentsService] })
export class StudentsModule {}
