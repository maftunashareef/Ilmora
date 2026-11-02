import { Module } from '@nestjs/common'
import { EnrollmentModule } from '../enrollment/enrollment.module'
import { SessionsModule } from '../sessions/sessions.module'
import { AttendanceController } from './attendance.controller'
import { AttendanceEvents } from './attendance.events'
import { AttendanceService } from './attendance.service'

@Module({
  imports: [SessionsModule, EnrollmentModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceEvents],
  exports: [AttendanceService, AttendanceEvents],
})
export class AttendanceModule {}
