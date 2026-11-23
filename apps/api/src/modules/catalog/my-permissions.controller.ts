import { Controller, Get } from '@nestjs/common'
import { CurrentActor, CurrentTenantId } from '../../common/decorators'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { SiteService } from '../site/site.service'

/**
 * The role-permission matrix is not public (Ж17): a signed-in account reads only the switches of its own role here
 * (a teacher the teacher ones, a student the student ones). Any signed-in account; anonymous callers get 401.
 */
@Controller('me')
export class MyPermissionsController {
  constructor(private readonly site: SiteService) {}

  @Get('permissions')
  permissions(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor) {
    return this.site.permissionsFor(tenantId, actor.roles)
  }
}
