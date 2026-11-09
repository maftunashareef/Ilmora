import { Controller, Get, Param, Post } from '@nestjs/common'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { CenterService } from './center.service'

/** A teacher's answer to a center's invitation: the teacher joins a center only by accepting it. */
@Controller('teacher/center-invites')
@Roles('TEACHER')
export class TeacherInvitesController {
  constructor(private readonly center: CenterService) {}

  @Get() list(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.center.myInvites(t, a) }
  @Post(':id/accept') accept(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.center.respondInvite(t, a, id, true) }
  @Post(':id/decline') decline(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.center.respondInvite(t, a, id, false) }
}
