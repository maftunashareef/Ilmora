import { Module } from '@nestjs/common'
import { ContactsModule } from '../contacts/contacts.module'
import { StudentsModule } from '../students/students.module'
import { CompanyVacanciesController, StudentVacanciesController } from './vacancies.controller'
import { VacanciesService } from './vacancies.service'

/** Practice and internships: the companies' vacancies and the students' applications (ТЗ 5.4). */
@Module({ imports: [ContactsModule, StudentsModule], controllers: [CompanyVacanciesController, StudentVacanciesController], providers: [VacanciesService] })
export class VacanciesModule {}
