import { Module } from '@nestjs/common'
import { JournalController, StudentHomeworkController, TeacherHomeworkController } from './classroom.controller'
import { HomeworkService } from './homework.service'
import { JournalService } from './journal.service'

/** The group journal and homework (ТЗ 2026-11-18, разделы 5 и 8). */
@Module({
  controllers: [JournalController, TeacherHomeworkController, StudentHomeworkController],
  providers: [JournalService, HomeworkService],
  exports: [JournalService, HomeworkService],
})
export class ClassroomModule {}
