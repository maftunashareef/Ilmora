import { Module } from '@nestjs/common'
import { ContactsModule } from '../contacts/contacts.module'
import { CompanyStudentsService } from './company-students.service'
import { CompanyAnnouncementsController, CompanyStudentsController, InstitutionAnnouncementsController } from './graduates.controller'
import { GraduatesService } from './graduates.service'

/**
 * Graduation announcements, the companies' answers and invitations of graduates (ТЗ 5.1), and the company's «Студенты»
 * section (ТЗ «Студенты у компании, Вакансии у учреждения», 2) — the named cards and their contact requests.
 */
@Module({ imports: [ContactsModule], controllers: [InstitutionAnnouncementsController, CompanyAnnouncementsController, CompanyStudentsController], providers: [GraduatesService, CompanyStudentsService] })
export class GraduatesModule {}
