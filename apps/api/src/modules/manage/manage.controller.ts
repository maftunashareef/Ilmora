import { InjectQueue } from '@nestjs/bullmq'
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { z } from 'zod'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import { QUEUES } from '../../infra/queue/queues'
import type { RequestActor } from '../../infra/tenancy/tenant-context'

/** A page number from the query string; anything that is not a positive integer is ignored (it used to answer 500 — №34). */
const num = (v?: string) => { const n = Number(v); return v !== undefined && Number.isInteger(n) && n > 0 ? n : undefined }
import { SiteService } from '../site/site.service'
import {
  AvatarUploadUrlInput, CategoryInput, CenterInput, CenterNameReviewInput, CenterStatusInput, CourseDiscountBody, CourseInput, CoursePatch, DeleteUserInput, GroupInput, GroupPatch, PackageInput, PackagePatch, PlaylistInput, PlaylistPatch, ResourceInput, ResourcePatch, StudentAdminInput, SubjectInput, TeacherInput, TeacherPatch, UserRolesInput, VideoInput, VideoPatch,
} from './manage.schemas'
import { ManageService } from './manage.service'

const body = <T>(schema: z.ZodType<T>) => new ZodValidationPipe(schema)
const GenerateDto = z.object({ days: z.number().int().min(1).max(90).default(28) }).strict()
const SiteDto = z.object({ data: z.unknown(), version: z.number().int().optional() }).strict()
const QueueParam = z.enum([QUEUES.sms, QUEUES.notifications, QUEUES.sessions, QUEUES.outbox, QUEUES.maintenance])

/** Teacher Studio and Super Admin write API. */
@Controller()
// Center admins are deliberately not listed here: they get only the center endpoints below (and attendance), never the Teacher Studio write API.
@Roles('TEACHER', 'PLATFORM_ADMIN')
export class ManageController {
  constructor(
    private readonly manage: ManageService,
    private readonly site: SiteService,
    @InjectQueue(QUEUES.sms) private readonly smsQueue: Queue,
    @InjectQueue(QUEUES.sessions) private readonly sessionsQueue: Queue,
    @InjectQueue(QUEUES.outbox) private readonly outboxQueue: Queue,
  ) {}

  @Get('manage/mine') mine(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.manage.mine(t, a) }
  @Patch('manage/profile') updateProfile(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(TeacherPatch)) dto: z.infer<typeof TeacherPatch>) { return this.manage.updateOwnTeacherProfile(t, a, dto) }
  @Patch('manage/teachers/:id') updateTeacherScoped(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(TeacherPatch)) dto: z.infer<typeof TeacherPatch>) { return this.manage.updateTeacherScoped(t, a, id, dto) }
  @Post('manage/profile/avatar/upload-url') avatarUploadUrl(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(AvatarUploadUrlInput)) dto: z.infer<typeof AvatarUploadUrlInput>) { return this.manage.generateAvatarUploadUrl(t, a, dto) }

  // courses & groups
  @Post('manage/courses') createCourse(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(CourseInput)) dto: z.infer<typeof CourseInput>) { return this.manage.createCourse(t, a, dto) }
  @Patch('manage/courses/:id') updateCourse(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(CoursePatch)) dto: z.infer<typeof CoursePatch>) { return this.manage.updateCourse(t, a, id, dto) }
  /** Center admins: the courses of their own center, and their discounts. */
  @Roles('CENTER_ADMIN') @Get('manage/center/courses') centerCourses(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.manage.listCenterCourses(t, a) }
  @Roles('CENTER_ADMIN', 'PLATFORM_ADMIN') @Put('manage/courses/:id/discount') setCourseDiscount(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(CourseDiscountBody)) dto: z.infer<typeof CourseDiscountBody>) { return this.manage.setCourseDiscount(t, a, id, dto.discount) }
  @Delete('manage/courses/:id') deleteCourse(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.manage.deleteCourse(t, a, id) }
  @Post('manage/courses/:courseId/groups') createGroup(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('courseId') courseId: string, @Body(body(GroupInput)) dto: GroupInput) { return this.manage.createGroup(t, a, courseId, dto) }
  @Get('manage/groups') groups(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor) { return this.manage.myGroups(t, a) }
  @Get('manage/groups/:id') group(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.manage.groupDetail(t, a, id) }
  @Patch('manage/groups/:id') updateGroup(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(GroupPatch)) dto: Partial<GroupInput>) { return this.manage.updateGroup(t, a, id, dto) }
  @Delete('manage/groups/:id') deleteGroup(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.manage.deleteGroup(t, a, id) }
  @Post('manage/groups/:id/sessions/generate') generate(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(GenerateDto)) dto: z.infer<typeof GenerateDto>) { return this.manage.generateGroupSessions(t, a, id, dto.days) }

  // content
  @Post('manage/videos') createVideo(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(VideoInput)) dto: z.infer<typeof VideoInput>) { return this.manage.createVideo(t, a, dto) }
  @Patch('manage/videos/:id') updateVideo(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(VideoPatch)) dto: z.infer<typeof VideoPatch>) { return this.manage.updateVideo(t, a, id, dto as z.infer<typeof VideoInput>) }
  @Delete('manage/videos/:id') deleteVideo(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.manage.deleteVideo(t, a, id) }
  @Post('manage/playlists') createPlaylist(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(PlaylistInput)) dto: z.infer<typeof PlaylistInput>) { return this.manage.createPlaylist(t, a, dto) }
  @Patch('manage/playlists/:id') updatePlaylist(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(PlaylistPatch)) dto: z.infer<typeof PlaylistPatch>) { return this.manage.updatePlaylist(t, a, id, dto as z.infer<typeof PlaylistInput>) }
  @Delete('manage/playlists/:id') deletePlaylist(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.manage.deletePlaylist(t, a, id) }
  @Post('manage/resources') createResource(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(ResourceInput)) dto: z.infer<typeof ResourceInput>) { return this.manage.createResource(t, a, dto) }
  @Patch('manage/resources/:id') updateResource(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(ResourcePatch)) dto: z.infer<typeof ResourcePatch>) { return this.manage.updateResource(t, a, id, dto as z.infer<typeof ResourceInput>) }
  @Delete('manage/resources/:id') deleteResource(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.manage.deleteResource(t, a, id) }
  @Post('manage/subjects') createSubject(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(SubjectInput)) dto: z.infer<typeof SubjectInput>) { return this.manage.upsertSubject(t, a, dto) }
  @Put('manage/subjects/:id') updateSubject(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(SubjectInput)) dto: z.infer<typeof SubjectInput>) { return this.manage.upsertSubject(t, a, dto, id) }
  @Delete('manage/subjects/:id') deleteSubject(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string) { return this.manage.deleteSubject(t, a, id) }

  // ── Super Admin ──
  /** Full site configuration for the Super Admin editor, including presets that are still disabled (internal). */
  @Roles('PLATFORM_ADMIN') @Get('admin/site') adminSite(@CurrentTenantId() t: string) { return this.site.get(t, true) }
  @Roles('PLATFORM_ADMIN') @Put('admin/site') updateSite(@CurrentTenantId() t: string, @Body(body(SiteDto)) dto: z.infer<typeof SiteDto>) { return this.site.update(t, dto.data, dto.version) }
  @Roles('PLATFORM_ADMIN') @Post('admin/site/university-logo/upload-url') universityLogoUploadUrl(@CurrentTenantId() t: string, @Body(body(AvatarUploadUrlInput)) dto: z.infer<typeof AvatarUploadUrlInput>) { return this.manage.generateUniversityLogoUploadUrl(t, dto) }
  @Roles('PLATFORM_ADMIN') @Get('admin/centers') listCenters(@CurrentTenantId() t: string) { return this.manage.listCenters(t) }
  @Roles('PLATFORM_ADMIN') @Post('admin/centers') createCenter(@CurrentTenantId() t: string, @Body(body(CenterInput)) dto: z.infer<typeof CenterInput>) { return this.manage.upsertCenter(t, dto) }
  @Roles('PLATFORM_ADMIN') @Put('admin/centers/:id') updateCenter(@CurrentTenantId() t: string, @Param('id') id: string, @Body(body(CenterInput)) dto: z.infer<typeof CenterInput>) { return this.manage.upsertCenter(t, dto, id) }
  @Roles('PLATFORM_ADMIN') @Patch('admin/centers/:id/status') centerStatus(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(CenterStatusInput)) dto: CenterStatusInput) { return this.manage.setCenterStatus(t, a, id, dto) }
  @Roles('PLATFORM_ADMIN') @Post('admin/centers/:id/name') reviewCenterName(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(CenterNameReviewInput)) dto: z.infer<typeof CenterNameReviewInput>) { return this.manage.reviewCenterName(t, a, id, dto.approve) }
  @Roles('PLATFORM_ADMIN') @Delete('admin/centers/:id') deleteCenter(@CurrentTenantId() t: string, @Param('id') id: string) { return this.manage.deleteCenter(t, id) }
  @Roles('PLATFORM_ADMIN') @Delete('admin/users/:id') deleteUser(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(DeleteUserInput)) dto: z.infer<typeof DeleteUserInput>) { return this.manage.deleteUser(t, a, id, dto.reason) }
  @Roles('PLATFORM_ADMIN') @Post('admin/categories') createCategory(@CurrentTenantId() t: string, @Body(body(CategoryInput)) dto: z.infer<typeof CategoryInput>) { return this.manage.upsertCategory(t, dto) }
  @Roles('PLATFORM_ADMIN') @Put('admin/categories/:id') updateCategory(@CurrentTenantId() t: string, @Param('id') id: string, @Body(body(CategoryInput)) dto: z.infer<typeof CategoryInput>) { return this.manage.upsertCategory(t, dto, id) }
  @Roles('PLATFORM_ADMIN') @Delete('admin/categories/:id') deleteCategory(@CurrentTenantId() t: string, @Param('id') id: string) { return this.manage.deleteCategory(t, id) }
  @Roles('PLATFORM_ADMIN') @Post('admin/teachers') createTeacher(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(TeacherInput)) dto: z.infer<typeof TeacherInput>) { return this.manage.upsertTeacher(t, a, dto) }
  @Roles('PLATFORM_ADMIN') @Patch('admin/teachers/:id') updateTeacher(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(TeacherPatch)) dto: z.infer<typeof TeacherPatch>) { return this.manage.upsertTeacher(t, a, dto, id) }
  @Roles('PLATFORM_ADMIN') @Delete('admin/teachers/:id') deleteTeacher(@CurrentTenantId() t: string, @Param('id') id: string) { return this.manage.deleteTeacher(t, id) }
  @Roles('PLATFORM_ADMIN') @Post('admin/packages') createPackage(@CurrentTenantId() t: string, @Body(body(PackageInput)) dto: z.infer<typeof PackageInput>) { return this.manage.upsertPackage(t, dto) }
  @Roles('PLATFORM_ADMIN') @Patch('admin/packages/:id') updatePackage(@CurrentTenantId() t: string, @Param('id') id: string, @Body(body(PackagePatch)) dto: z.infer<typeof PackagePatch>) { return this.manage.upsertPackage(t, dto, id) }
  @Roles('PLATFORM_ADMIN') @Get('admin/stats') adminStats(@CurrentTenantId() t: string) { return this.manage.adminStats(t) }
  @Roles('PLATFORM_ADMIN') @Get('admin/users') users(@CurrentTenantId() t: string, @Query('role') role?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.manage.listUsers(t, { role, search, page: num(page), pageSize: num(pageSize) }) }
  @Roles('PLATFORM_ADMIN') @Put('admin/users/:id/roles') roles(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Param('id') id: string, @Body(body(UserRolesInput)) dto: z.infer<typeof UserRolesInput>) { return this.manage.setRoles(t, a, id, dto) }
  @Roles('PLATFORM_ADMIN') @Patch('admin/users/:id') updateStudent(@CurrentTenantId() t: string, @Param('id') id: string, @Body(body(StudentAdminInput)) dto: z.infer<typeof StudentAdminInput>) { return this.manage.updateStudent(t, id, dto) }
  @Roles('PLATFORM_ADMIN') @Get('admin/review-queue') reviewQueue(@CurrentTenantId() t: string) { return this.manage.reviewQueue(t) }
  @Roles('PLATFORM_ADMIN', 'FINANCE_ADMIN') @Get('admin/audit') audit(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Query('entityType') entityType?: string, @Query('entityId') entityId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.manage.audits(t, a, { entityType, entityId, page: num(page), pageSize: num(pageSize) }) }
  @Roles('PLATFORM_ADMIN') @Get('admin/inquiries') inquiries(@CurrentTenantId() t: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.manage.listInquiries(t, { page: num(page), pageSize: num(pageSize) }) }
  @Roles('PLATFORM_ADMIN') @Patch('admin/inquiries/:id/handle') handleInquiry(@CurrentTenantId() t: string, @Param('id') id: string) { return this.manage.toggleInquiryHandled(t, id) }

  /** Failed-job visibility: counts per queue and the most recent failures with their reasons. */
  @Roles('PLATFORM_ADMIN') @Get('admin/jobs')
  async jobs() {
    const queues = [this.smsQueue, this.sessionsQueue, this.outboxQueue]
    return Promise.all(queues.map(async (q) => {
      const [counts, failed] = await Promise.all([q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'), q.getFailed(0, 20)])
      return { queue: q.name, counts, failed: failed.map((j) => ({ id: j.id, name: j.name, attemptsMade: j.attemptsMade, failedReason: j.failedReason?.slice(0, 300), finishedOn: j.finishedOn, data: redact(j.data) })) }
    }))
  }

  @Roles('PLATFORM_ADMIN') @Post('admin/jobs/:queue/:id/retry')
  async retry(@Param('queue') queue: string, @Param('id') id: string) {
    const name = QueueParam.parse(queue)
    const q = name === QUEUES.sms ? this.smsQueue : name === QUEUES.sessions ? this.sessionsQueue : this.outboxQueue
    const job = await q.getJob(id)
    if (!job) return { ok: false }
    await job.retry()
    return { ok: true }
  }
}

function redact(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) out[k] = /encrypted|code|token|phone/i.test(k) ? '[redacted]' : v
  return out
}
