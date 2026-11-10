import { Controller, Get, Param, Post } from '@nestjs/common'
import { ClientInfo, type ClientInfoValue, CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { Approved } from '../../common/registry-access'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { ContactsService } from './contacts.service'

/** The company's contact requests and, once accepted, the students' full cards (ТЗ 4.3 «Мои контакты»). */
@Controller('companies/me/contacts')
@Roles('COMPANY_ADMIN')
@Approved('company')
export class CompanyContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get() list(@CurrentActor() a: RequestActor) { return this.contacts.companyList(a) }
  @Get(':id') one(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.contacts.companyContact(a, id) }
  @Get(':id/certificates/:certId/file') file(@CurrentActor() a: RequestActor, @Param('id') id: string, @Param('certId') certId: string) { return this.contacts.certificateLink(a, id, certId) }
}

/** The student's incoming contact requests (ТЗ 4.1 «Запросы от компаний»): accept or decline each. */
@Controller('students/me/contact-requests')
@Roles('STUDENT')
export class StudentContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get() list(@CurrentActor() a: RequestActor) { return this.contacts.studentList(a) }
  @Post(':id/accept') accept(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @ClientInfo() ci: ClientInfoValue, @Param('id') id: string) { return this.contacts.decide(t, a, id, true, ci.ip) }
  /** «Отозвать доступ»: the contacts opened to this company are closed again. */
  @Post(':id/revoke') revoke(@CurrentActor() a: RequestActor, @Param('id') id: string) { return this.contacts.revoke(a, id) }
  @Post(':id/decline') decline(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.contacts.decide(t, a, id, false) }
}
