import { Module } from '@nestjs/common'
import { RegistryModule } from '../registry/registry.module'
import { CertificatesService } from './certificates.service'
import { InstitutionStudentsController, StudentsController } from './students.controller'
import { StudentsService } from './students.service'

/** Students of the registry: the questionnaire (ТЗ 4.1), the institution's confirmation of study, certificates and courses (ТЗ 5.5). */
@Module({ imports: [RegistryModule], controllers: [StudentsController, InstitutionStudentsController], providers: [StudentsService, CertificatesService], exports: [StudentsService] })
export class StudentsModule {}
