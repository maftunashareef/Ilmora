import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { z } from 'zod'
import { CurrentActor, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { ExtensionInput, GradeInput, HomeworkInput, HomeworkListQuery, HomeworkPatch, JournalMarkInput, JournalQuery, SubmissionInput } from './classroom.schemas'
import { HomeworkService } from './homework.service'
import { JournalService } from './journal.service'

const body = <T>(schema: z.ZodType<T>) => new ZodValidationPipe(schema)

/**
 * The group journal (ТЗ 2026-11-18, 5): the course's teacher and the center's administrator; the Super Admin passes
 * every role check. Ownership of the group is checked by the service (another teacher's group is 403).
 */
@Controller('teacher/groups/:id/attendance')
@Roles('TEACHER', 'CENTER_ADMIN')
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  // The center's manager reads the journal; marks stay with the teacher and the center's administrator (№15, 19.11).
  @Get() @Roles('TEACHER', 'CENTER_ADMIN', 'CENTER_MANAGER') get(@Param('id') id: string, @CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(JournalQuery)) q: z.infer<typeof JournalQuery>) { return this.journal.journal(id, a, q.month) }

  @Put('marks')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  mark(@Param('id') id: string, @CurrentActor() a: RequestActor, @Body(body(JournalMarkInput)) dto: JournalMarkInput) { return this.journal.setMark(id, a, dto) }
}

/** Homework, the teacher's side (ТЗ 8.1, 8.3): the teacher of the group's course only. */
@Controller('teacher/homework')
@Roles('TEACHER')
export class TeacherHomeworkController {
  constructor(private readonly homework: HomeworkService) {}

  @Get() list(@CurrentActor() a: RequestActor, @Query(new ZodValidationPipe(HomeworkListQuery)) q: z.infer<typeof HomeworkListQuery>) { return this.homework.list(a, q.groupId) }
  @Post() create(@CurrentActor() a: RequestActor, @Body(body(HomeworkInput)) dto: HomeworkInput) { return this.homework.create(a, dto) }
  @Get(':id') detail(@Param('id') id: string, @CurrentActor() a: RequestActor) { return this.homework.detail(a, id) }
  @Patch(':id') update(@Param('id') id: string, @CurrentActor() a: RequestActor, @Body(body(HomeworkPatch)) dto: HomeworkPatch) { return this.homework.update(a, id, dto) }
  @Delete(':id') remove(@Param('id') id: string, @CurrentActor() a: RequestActor) { return this.homework.remove(a, id) }
  @Post(':id/extensions') extend(@Param('id') id: string, @CurrentActor() a: RequestActor, @Body(body(ExtensionInput)) dto: ExtensionInput) { return this.homework.extend(a, id, dto) }
  @Post(':id/grades') grade(@Param('id') id: string, @CurrentActor() a: RequestActor, @Body(body(GradeInput)) dto: GradeInput) { return this.homework.grade(a, id, dto) }
}

/** Homework, the student's side (ТЗ 8.2): the homework of the student's own groups. */
@Controller('students/me/homework')
@Roles('STUDENT')
export class StudentHomeworkController {
  constructor(private readonly homework: HomeworkService) {}

  @Get() list(@CurrentActor() a: RequestActor) { return this.homework.myList(a) }
  @Get(':id') detail(@Param('id') id: string, @CurrentActor() a: RequestActor) { return this.homework.myDetail(a, id) }

  @Post(':id/submissions')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  submit(@Param('id') id: string, @CurrentActor() a: RequestActor, @Body(body(SubmissionInput)) dto: SubmissionInput) { return this.homework.submit(a, id, dto) }
}
