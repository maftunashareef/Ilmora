import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { CenterProfileInput, CenterTeacherInput, CenterTeacherPatch, CourseInput, CoursePatch, GroupInput, GroupPatch } from '../manage/manage.schemas'
import { ManageService } from '../manage/manage.service'
import { CenterService } from './center.service'

const body = <T>(schema: z.ZodType<T>) => new ZodValidationPipe(schema)
export const GenerateDto = z.object({ days: z.number().int().min(1).max(90).default(28) }).strict()

/**
 * Educational Center workspace API. Every route is restricted to the administrator's own center (`actor.centerId`);
 * courses and groups go through ManageService, which enforces the same scope and the publishing rules.
 */
@Controller('center')
@Roles('CENTER_ADMIN')
export class CenterController {
  constructor(private readonly center: CenterService, private readonly manage: ManageService) {}

  @Get('overview') overview(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.center.overview(t, a) }
  @Patch('profile') profile(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(CenterProfileInput)) dto: CenterProfileInput) { return this.center.updateProfile(t, a, dto) }
  @Get('qr') qr(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.center.qr(t, a) }
  @Post('qr/rotate') rotateQr(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.center.rotateQr(t, a) }
  @Get('attendance') attendance(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Query('date') date?: string) { return this.center.attendanceDay(t, a, date) }

  // teachers
  @Get('teachers') teachers(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.center.teachers(t, a) }
  @Post('teachers') addTeacher(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(CenterTeacherInput)) dto: CenterTeacherInput) { return this.center.addTeacher(t, a, dto) }
  @Patch('teachers/:id') updateTeacher(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(CenterTeacherPatch)) dto: CenterTeacherPatch) { return this.center.updateTeacher(t, a, id, dto) }
  @Delete('teachers/:id') removeTeacher(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.center.removeTeacher(t, a, id) }

  // students
  @Get('students') students(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.center.students(t, a) }

  // courses, groups and schedules (ManageService keeps a center inside its own courses)
  @Get('courses') courses(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.manage.listCenterCourses(t, a) }
  @Post('courses') createCourse(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(CourseInput)) dto: z.infer<typeof CourseInput>) { return this.manage.createCourse(t, a, { ...dto, centerId: a.centerId ?? dto.centerId }) }
  @Patch('courses/:id') updateCourse(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(CoursePatch)) dto: z.infer<typeof CoursePatch>) { return this.manage.updateCourse(t, a, id, dto) }
  @Delete('courses/:id') deleteCourse(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.manage.deleteCourse(t, a, id) }
  @Post('courses/:courseId/groups') createGroup(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('courseId') courseId: string, @Body(body(GroupInput)) dto: GroupInput) { return this.manage.createGroup(t, a, courseId, dto) }
  @Get('groups') groups(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.manage.myGroups(t, a) }
  @Get('groups/:id') group(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.manage.groupDetail(t, a, id) }
  @Patch('groups/:id') updateGroup(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(GroupPatch)) dto: Partial<GroupInput>) { return this.manage.updateGroup(t, a, id, dto) }
  @Delete('groups/:id') deleteGroup(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.manage.deleteGroup(t, a, id) }
  @Post('groups/:id/sessions/generate') generate(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(GenerateDto)) dto: z.infer<typeof GenerateDto>) { return this.manage.generateGroupSessions(t, a, id, dto.days) }
}
