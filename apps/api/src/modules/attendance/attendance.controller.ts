import { Body, Controller, Get, Param, Patch, Post, Sse, type MessageEvent } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { IsIn, IsOptional, IsString, Length } from 'class-validator'
import { map, type Observable } from 'rxjs'
import { ClientInfo, type ClientInfoValue, CurrentActor, Public, Roles } from '../../common/decorators'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AttendanceEvents } from './attendance.events'
import { AttendanceService } from './attendance.service'

class CheckInDto {
  @IsString() @Length(1, 80) sessionId!: string
  @IsString() @Length(1, 120) token!: string
}
class CorrectionDto {
  @IsString() @Length(1, 80) studentId!: string
  @IsIn(['PRESENT', 'ABSENT', 'EXCUSED']) status!: 'PRESENT' | 'ABSENT' | 'EXCUSED'
  @IsString() @Length(3, 300) reason!: string
}
class SessionStatusDto {
  @IsIn(['scheduled', 'cancelled', 'completed']) status!: 'scheduled' | 'cancelled' | 'completed'
  @IsOptional() @IsString() @Length(0, 300) reason?: string
}

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService, private readonly events: AttendanceEvents) {}

  // ── student ──
  @Post('attendance/check-in')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  checkIn(@CurrentActor() actor: RequestActor, @Body() dto: CheckInDto, @ClientInfo() ci: ClientInfoValue) {
    return this.attendance.checkIn(actor.id, dto, { ip: ci.ip, userAgent: ci.userAgent })
  }

  @Public()
  @Get('attendance/links/:sessionId')
  describe(@Param('sessionId') sessionId: string) {
    return this.attendance.describeLink(sessionId)
  }

  @Get('student/attendance')
  mine(@CurrentActor() actor: RequestActor) {
    return this.attendance.myAttendance(actor.id)
  }

  // ── teacher ──
  @Roles('TEACHER', 'CENTER_ADMIN')
  @Get('teacher/sessions/:id')
  detail(@Param('id') id: string, @CurrentActor() actor: RequestActor) {
    return this.attendance.sessionDetail(id, actor)
  }

  @Roles('TEACHER', 'CENTER_ADMIN')
  @Post('teacher/sessions/:id/open')
  open(@Param('id') id: string, @CurrentActor() actor: RequestActor) {
    return this.attendance.open(id, actor)
  }

  @Roles('TEACHER', 'CENTER_ADMIN')
  @Post('teacher/sessions/:id/close')
  close(@Param('id') id: string, @CurrentActor() actor: RequestActor) {
    return this.attendance.close(id, actor)
  }

  @Roles('TEACHER', 'CENTER_ADMIN')
  @Post('teacher/sessions/:id/qr')
  qr(@Param('id') id: string, @CurrentActor() actor: RequestActor) {
    return this.attendance.qr(id, actor)
  }

  @Roles('TEACHER', 'CENTER_ADMIN')
  @Post('teacher/sessions/:id/records')
  correct(@Param('id') id: string, @CurrentActor() actor: RequestActor, @Body() dto: CorrectionDto) {
    return this.attendance.correct(id, actor, dto)
  }

  @Roles('TEACHER', 'CENTER_ADMIN')
  @Patch('teacher/sessions/:id')
  status(@Param('id') id: string, @CurrentActor() actor: RequestActor, @Body() dto: SessionStatusDto) {
    return this.attendance.setStatus(id, dto.status, actor, dto.reason)
  }

  /** Server-sent events for one session (ownership checked before subscribing). Clients also poll as a fallback. */
  @Roles('TEACHER', 'CENTER_ADMIN')
  @Sse('teacher/sessions/:id/stream')
  async stream(@Param('id') id: string, @CurrentActor() actor: RequestActor): Promise<Observable<MessageEvent>> {
    await this.attendance.sessionForTeacher(id, actor)
    return this.events.stream(id).pipe(map((event) => ({ data: event, type: event.type }) as MessageEvent))
  }
}
