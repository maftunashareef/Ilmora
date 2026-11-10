import { Module } from '@nestjs/common'
import { ContactsModule } from '../contacts/contacts.module'
import { StudentsModule } from '../students/students.module'
import { CompanyContractHelpController, StudentContractHelpController } from './contract-help.controller'
import { ContractHelpService } from './contract-help.service'

/** Help with the contract fee: the student's request, the anonymised feed, «Заинтересованы» (ТЗ 5.3). */
@Module({ imports: [ContactsModule, StudentsModule], controllers: [StudentContractHelpController, CompanyContractHelpController], providers: [ContractHelpService] })
export class ContractHelpModule {}
