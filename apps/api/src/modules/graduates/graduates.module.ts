import { Module } from '@nestjs/common'
import { ContactsModule } from '../contacts/contacts.module'
import { CompanyAnnouncementsController, InstitutionAnnouncementsController } from './graduates.controller'
import { GraduatesService } from './graduates.service'

/** Graduation announcements, the companies' answers and invitations of graduates (ТЗ 5.1). */
@Module({ imports: [ContactsModule], controllers: [InstitutionAnnouncementsController, CompanyAnnouncementsController], providers: [GraduatesService] })
export class GraduatesModule {}
