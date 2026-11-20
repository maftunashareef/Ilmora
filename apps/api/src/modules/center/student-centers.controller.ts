import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { InviteAcceptBody, InviteTokenBody } from './center-students.schemas'
import { CenterStudentsService } from './center-students.service'

/**
 * The student's side of a center's table (ТЗ 2026-11-18, 4.3): opening and accepting an invitation, and the student's
 * own centers with «leave». The invitation token travels in the request body only — never the path or the query — so it
 * reaches neither the server logs nor Referer; a wrong, used or expired token gets one and the same answer.
 */
@Controller('students/me')
@Roles('STUDENT')
export class StudentCentersController {
  constructor(private readonly students: CenterStudentsService) {}

  @Post('center-invites/preview')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  preview(@Body(new ZodValidationPipe(InviteTokenBody)) dto: InviteTokenBody) { return this.students.invitePreview(dto.token) }

  @Post('center-invites/accept')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  accept(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(new ZodValidationPipe(InviteAcceptBody)) dto: InviteAcceptBody) { return this.students.acceptInvite(t, a, dto) }

  @Get('centers') centers(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.students.myCenters(t, a) }
  @Post('centers/:id/leave') leave(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.students.leave(t, a, id) }
}
