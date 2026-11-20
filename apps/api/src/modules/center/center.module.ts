import { Module } from '@nestjs/common'
import { AttendanceModule } from '../attendance/attendance.module'
import { ManageModule } from '../manage/manage.module'
import { SessionsModule } from '../sessions/sessions.module'
import { AdminCenterController } from './admin-center.controller'
import { CenterStudentsService } from './center-students.service'
import { CenterController } from './center.controller'
import { CenterService } from './center.service'
import { StudentCentersController } from './student-centers.controller'
import { TeacherInvitesController } from './teacher-invites.controller'

/** Educational Center workspace (role CENTER_ADMIN) and the Super Admin's view of any center (PLATFORM_ADMIN). */
@Module({
  imports: [AttendanceModule, ManageModule, SessionsModule],
  controllers: [CenterController, AdminCenterController, TeacherInvitesController, StudentCentersController],
  providers: [CenterService, CenterStudentsService],
})
export class CenterModule {}
