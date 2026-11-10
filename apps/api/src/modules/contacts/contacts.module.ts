import { Module } from '@nestjs/common'
import { CompanyContactsController, StudentContactsController } from './contacts.controller'
import { ContactsService } from './contacts.service'

/** Contact requests between companies and students (ТЗ 5.1, 5.3, 8). */
@Module({ controllers: [CompanyContactsController, StudentContactsController], providers: [ContactsService], exports: [ContactsService] })
export class ContactsModule {}
