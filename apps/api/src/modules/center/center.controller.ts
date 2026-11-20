import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { z } from 'zod'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { CenterProfileInput, CenterTeacherInput, CenterTeacherPatch, CourseInput, CoursePatch, GroupInput, GroupPatch } from '../manage/manage.schemas'
import { ManageService } from '../manage/manage.service'
import { CenterStudentInput, CenterStudentPatch, RosterExportQuery, RosterImportBody, RosterQuery } from './center-students.schemas'
import { CenterStudentsService } from './center-students.service'
import { CenterService } from './center.service'

const body = <T>(schema: z.ZodType<T>) => new ZodValidationPipe(schema)
export const GenerateDto = z.object({ days: z.number().int().min(1).max(90).default(28) }).strict()

/** Sends an Excel file (export of the students table or its template); the service has written the audit row. */
export function sendXlsx(res: Response, out: { file: Buffer; filename: string }) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.send(out.file)
}

/**
 * Educational Center workspace API. Every route is restricted to the administrator's own center (`actor.centerId`);
 * courses and groups go through ManageService, which enforces the same scope and the publishing rules.
 */
@Controller('center')
@Roles('CENTER_ADMIN')
export class CenterController {
  constructor(private readonly center: CenterService, private readonly manage: ManageService, private readonly table: CenterStudentsService) {}

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
  // The center's table of students (ТЗ 2026-11-18, 4): fixed paths first, then :id.
  @Get('students/roster') roster(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(RosterQuery)) q: RosterQuery) { return this.table.roster(t, a, q) }
  @Get('students/export')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async exportStudents(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(RosterExportQuery)) q: RosterExportQuery, @Res() res: Response) { sendXlsx(res, await this.table.exportFile(t, a, q)) }
  @Post('students/import/check')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  importCheck(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(RosterImportBody)) dto: RosterImportBody) { return this.table.importCheck(t, a, dto.file) }
  @Post('students/import')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  importStudents(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(RosterImportBody)) dto: RosterImportBody) { return this.table.importCommit(t, a, dto.file) }
  @Post('students') addStudent(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(CenterStudentInput)) dto: CenterStudentInput) { return this.table.create(t, a, dto) }
  @Get('students/:id') student(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.table.detail(t, a, id) }
  @Patch('students/:id') updateStudent(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(CenterStudentPatch)) dto: CenterStudentPatch) { return this.table.update(t, a, id, dto) }
  @Post('students/:id/invite')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  inviteStudent(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.table.invite(t, a, id) }

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
