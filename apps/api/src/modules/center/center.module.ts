import { Module } from '@nestjs/common'
import { AttendanceModule } from '../attendance/attendance.module'
import { ManageModule } from '../manage/manage.module'
import { SessionsModule } from '../sessions/sessions.module'
import { CenterController } from './center.controller'
import { CenterService } from './center.service'

/** Educational Center workspace (role CENTER_ADMIN). */
@Module({
  imports: [AttendanceModule, ManageModule, SessionsModule],
  controllers: [CenterController],
  providers: [CenterService],
})
export class CenterModule {}
