import { Module } from '@nestjs/common'
import { ContactsModule } from '../contacts/contacts.module'
import { PaymentsModule } from '../payments/payments.module'
import { StudentsModule } from '../students/students.module'
import { InstitutionVacanciesService } from './institution-vacancies.service'
import { CompanyVacanciesController, InstitutionVacanciesController, StudentVacanciesController } from './vacancies.controller'
import { VacanciesService } from './vacancies.service'

/**
 * Vacancies — practice, internship, «Работа»: the companies' vacancies, the students' applications (ТЗ 5.4), and the
 * institutions' view with «Разослать студентам» (ТЗ «Студенты у компании, Вакансии у учреждения», 3); the broadcasts go
 * out through the outbox (PaymentsModule owns it).
 */
@Module({
  imports: [ContactsModule, StudentsModule, PaymentsModule],
  controllers: [CompanyVacanciesController, StudentVacanciesController, InstitutionVacanciesController],
  providers: [VacanciesService, InstitutionVacanciesService],
})
export class VacanciesModule {}
