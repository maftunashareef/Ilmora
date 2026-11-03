import { Body, Controller, Get, Param, Patch, Post, Sse, type MessageEvent } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { IsIn, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator'
import { map, type Observable } from 'rxjs'
import { ClientInfo, type ClientInfoValue, CurrentActor, Public, Roles } from '../../common/decorators'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AttendanceEvents } from './attendance.events'
import { AttendanceService } from './attendance.service'

class CheckInDto {
  @IsString() @Length(1, 80) sessionId!: string
  @IsString() @Length(1, 120) token!: string
}
/** Center QR check-in: the chosen lesson and, when the center asks for it, the browser's position. */
class CenterCheckInDto {
  @IsString() @Length(1, 80) sessionId!: string
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number
  @IsOptional() @IsNumber() @Min(0) @Max(100_000) accuracyM?: number
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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
class ExtraSessionDto {
  @Matches(DATE_RE) date!: string
  @Matches(TIME_RE) start!: string
  @Matches(TIME_RE) end!: string
  @IsOptional() @IsString() @Length(0, 300) note?: string
}
class RescheduleDto {
  @IsOptional() @Matches(DATE_RE) date?: string
  @IsOptional() @Matches(TIME_RE) start?: string
  @IsOptional() @Matches(TIME_RE) end?: string
  @IsOptional() @IsString() @Length(0, 300) note?: string
}

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService, private readonly events: AttendanceEvents) {}

  // ── student: lesson QR shown by the teacher ──
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

  // ── student: the center's standing QR code ──
  @Public()
  @Get('attendance/centers/:code')
  describeCenter(@Param('code') code: string) {
    return this.attendance.describeCenterCode(code)
  }

  @Get('attendance/centers/:code/options')
  centerOptions(@Param('code') code: string, @CurrentActor() actor: RequestActor) {
    return this.attendance.centerOptions(code, actor.id)
  }

  @Post('attendance/centers/:code/check-in')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  centerCheckIn(@Param('code') code: string, @CurrentActor() actor: RequestActor, @Body() dto: CenterCheckInDto, @ClientInfo() ci: ClientInfoValue) {
    return this.attendance.centerCheckIn(code, actor.id, dto, { ip: ci.ip, userAgent: ci.userAgent })
  }

  @Get('student/attendance')
  mine(@CurrentActor() actor: RequestActor) {
    return this.attendance.myAttendance(actor.id)
  }

  // ── teacher and center administrator ──
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

  /** Schedule exception: move a lesson (same date = new times; another date = cancelled original + new lesson). */
  @Roles('TEACHER', 'CENTER_ADMIN')
  @Patch('teacher/sessions/:id/time')
  reschedule(@Param('id') id: string, @CurrentActor() actor: RequestActor, @Body() dto: RescheduleDto) {
    return this.attendance.rescheduleSession(id, actor, dto)
  }

  /** Schedule exception: a one-off lesson for a group. */
  @Roles('TEACHER', 'CENTER_ADMIN')
  @Post('teacher/groups/:id/sessions')
  extra(@Param('id') id: string, @CurrentActor() actor: RequestActor, @Body() dto: ExtraSessionDto) {
    return this.attendance.addExtraSession(id, actor, dto)
  }

  /** Server-sent events for one session (ownership checked before subscribing). Clients also poll as a fallback. */
  @Roles('TEACHER', 'CENTER_ADMIN')
  @Sse('teacher/sessions/:id/stream')
  async stream(@Param('id') id: string, @CurrentActor() actor: RequestActor): Promise<Observable<MessageEvent>> {
    await this.attendance.sessionForTeacher(id, actor)
    return this.events.stream(id).pipe(map((event) => ({ data: event, type: event.type }) as MessageEvent))
  }
}
