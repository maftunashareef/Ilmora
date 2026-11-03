import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { CenterProfileInput, CenterTeacherInput, CenterTeacherPatch, CourseInput, CoursePatch, GroupInput, GroupPatch } from '../manage/manage.schemas'
import { ManageService } from '../manage/manage.service'
import { GenerateDto } from './center.controller'
import { CenterService } from './center.service'

const body = <T>(schema: z.ZodType<T>) => new ZodValidationPipe(schema)

/** The Super Admin acting on one center: the services scope everything by `actor.centerId`, so the route's id goes there. */
export const asCenter = (actor: RequestActor, centerId: string): RequestActor => ({ ...actor, centerId })

/**
 * Super Admin view of any center's workspace. The routes mirror `/center/*` with the center chosen by id, so the owner
 * sees and manages exactly what the center's own administrators see; every write is audited under the owner's account.
 */
@Controller('admin/centers/:centerId')
@Roles('PLATFORM_ADMIN')
export class AdminCenterController {
  constructor(private readonly center: CenterService, private readonly manage: ManageService) {}

  @Get('overview') overview(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string) { return this.center.overview(t, asCenter(a, c)) }
  @Patch('profile') profile(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Body(body(CenterProfileInput)) dto: CenterProfileInput) { return this.center.updateProfile(t, asCenter(a, c), dto) }
  @Get('qr') qr(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string) { return this.center.qr(t, asCenter(a, c)) }
  @Post('qr/rotate') rotateQr(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string) { return this.center.rotateQr(t, asCenter(a, c)) }
  @Get('attendance') attendance(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Query('date') date?: string) { return this.center.attendanceDay(t, asCenter(a, c), date) }

  // teachers
  @Get('teachers') teachers(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string) { return this.center.teachers(t, asCenter(a, c)) }
  @Post('teachers') addTeacher(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Body(body(CenterTeacherInput)) dto: CenterTeacherInput) { return this.center.addTeacher(t, asCenter(a, c), dto) }
  @Patch('teachers/:id') updateTeacher(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Param('id') id: string, @Body(body(CenterTeacherPatch)) dto: CenterTeacherPatch) { return this.center.updateTeacher(t, asCenter(a, c), id, dto) }
  @Delete('teachers/:id') removeTeacher(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Param('id') id: string) { return this.center.removeTeacher(t, asCenter(a, c), id) }

  // students
  @Get('students') students(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string) { return this.center.students(t, asCenter(a, c)) }

  // courses, groups and schedules
  @Get('courses') courses(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string) { return this.manage.listCenterCourses(t, asCenter(a, c)) }
  @Post('courses') createCourse(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Body(body(CourseInput)) dto: z.infer<typeof CourseInput>) { return this.manage.createCourse(t, asCenter(a, c), { ...dto, centerId: c }) }
  @Patch('courses/:id') updateCourse(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Param('id') id: string, @Body(body(CoursePatch)) dto: z.infer<typeof CoursePatch>) { return this.manage.updateCourse(t, asCenter(a, c), id, dto) }
  @Delete('courses/:id') deleteCourse(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Param('id') id: string) { return this.manage.deleteCourse(t, asCenter(a, c), id) }
  @Post('courses/:courseId/groups') createGroup(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Param('courseId') courseId: string, @Body(body(GroupInput)) dto: GroupInput) { return this.manage.createGroup(t, asCenter(a, c), courseId, dto) }
  @Get('groups') groups(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string) { return this.manage.myGroups(t, asCenter(a, c)) }
  @Get('groups/:id') group(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Param('id') id: string) { return this.manage.groupDetail(t, asCenter(a, c), id) }
  @Patch('groups/:id') updateGroup(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Param('id') id: string, @Body(body(GroupPatch)) dto: Partial<GroupInput>) { return this.manage.updateGroup(t, asCenter(a, c), id, dto) }
  @Delete('groups/:id') deleteGroup(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Param('id') id: string) { return this.manage.deleteGroup(t, asCenter(a, c), id) }
  @Post('groups/:id/sessions/generate') generate(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('centerId') c: string, @Param('id') id: string, @Body(body(GenerateDto)) dto: z.infer<typeof GenerateDto>) { return this.manage.generateGroupSessions(t, asCenter(a, c), id, dto.days) }
}
