import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { AttendanceController } from './attendance.controller'
import { AttendanceEvents } from './attendance.events'
import { AttendanceService } from './attendance.service'

@Module({
  imports: [SessionsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceEvents],
  exports: [AttendanceService],
})
export class AttendanceModule {}
