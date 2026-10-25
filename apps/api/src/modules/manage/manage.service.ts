import { Inject, Injectable } from '@nestjs/common'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { z } from 'zod'
import { normalizeUzPhone, somToTiyin, validateCapacity } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { addDays } from '../../common/time'
import { ENV, type Env, s3Configured } from '../../config/env'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { TenantContext, type RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { toCourse, toGroup, toPlaylist, toResource, toTeacher, toVideo } from '../catalog/catalog.service'
import { SessionsService } from '../sessions/sessions.service'
import { SiteService } from '../site/site.service'
import type { AvatarUploadUrlInput, CourseInput, CoursePatch, GroupInput, PackageInput, PlaylistInput, PublishableInput, ResourceInput, SubjectInput, TeacherInput, TeacherPatch, UserRolesInput, VideoInput } from './manage.schemas'

type Json = Prisma.InputJsonValue
const up = <T extends string>(v: T) => v.toUpperCase()
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[‘’'`ʻ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item'

/**
 * Teacher Studio + Super Admin write operations. Teachers act on their own content (ownership = teacherId),
 * center admins on their center, platform admins everywhere. Teacher permissions from the site template
 * (prices, schedules, direct publishing) are enforced here, not only hidden in the UI.
 */
@Injectable()
export class ManageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
    private readonly site: SiteService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private isAdmin(actor: RequestActor) { return actor.roles.includes('PLATFORM_ADMIN') }
  private isCenterAdmin(actor: RequestActor) { return actor.roles.includes('CENTER_ADMIN') }

  private assertTeacherScope(actor: RequestActor, item: { teacherId: string; centerId?: string | null }) {
    if (this.isAdmin(actor)) return
    if (this.isCenterAdmin(actor) && item.centerId && item.centerId === actor.centerId) return
    if (actor.teacherProfileId && actor.teacherProfileId === item.teacherId) return
    throw AppError.forbidden('You can only manage your own content')
  }

  private async teacherPermissions(tenantId: string) {
    if (!this.site || typeof this.site.get !== 'function') {
      return { customizeChannel: true, editCourses: true, editPrices: false, editSchedules: true, manageGroups: true, publishDirectly: true, uploadResources: true }
    }
    try {
      const site = await this.site.get(tenantId)
      return (site?.permissions?.teacher ?? {}) as Record<string, boolean>
    } catch {
      return { customizeChannel: true, editCourses: true, editPrices: false, editSchedules: true, manageGroups: true, publishDirectly: true, uploadResources: true }
    }
  }

  private resolveTeacherId(actor: RequestActor, requested?: string): string {
    if (this.isAdmin(actor) || this.isCenterAdmin(actor)) {
      if (requested) return requested
      if (actor.teacherProfileId) return actor.teacherProfileId
      throw AppError.invalid('teacher_required', 'teacherId is required')
    }
    if (!actor.teacherProfileId) throw AppError.forbidden('No teacher profile linked to this account')
    if (requested && requested !== actor.teacherProfileId) throw AppError.forbidden('Cannot create content for another teacher')
    return actor.teacherProfileId
  }

  private publishableData(input: PublishableInput, actor: RequestActor, direct: boolean) {
    const data: Record<string, unknown> = {}
    if (input.visibility) data.visibility = up(input.visibility)
    if (input.audience) { data.audienceStudentIds = input.audience.studentIds; data.audienceGroupIds = input.audience.groupIds }
    if (input.featured !== undefined && this.isAdmin(actor)) data.featured = input.featured
    if (input.reviewRequested !== undefined) data.reviewRequested = input.reviewRequested
    if (input.status) {
      if (input.status === 'published' && !direct && !this.isAdmin(actor)) { data.reviewRequested = true } else { data.status = up(input.status); if (input.status === 'published') { data.publishedAt = new Date(); data.reviewRequested = false } }
    }
    return data
  }

  // ───────── overview for the studio ─────────
  async mine(tenantId: string, actor: RequestActor) {
    const teacherId = this.isAdmin(actor) || this.isCenterAdmin(actor) ? undefined : actor.teacherProfileId ?? '__none__'
    const where = teacherId ? { tenantId, teacherId } : this.isCenterAdmin(actor) ? { tenantId, teacher: { centerId: actor.centerId ?? '__none__' } } : { tenantId }
    const [courses, videos, playlists, resources, subjects, seats] = await Promise.all([
      this.prisma.client.course.findMany({ where, include: { groups: { where: { deletedAt: null } } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.video.findMany({ where, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.playlist.findMany({ where, include: { items: { orderBy: { position: 'asc' } } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.resource.findMany({ where, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.subject.findMany({ where: teacherId ? { tenantId, teacherId } : { tenantId } }),
      this.prisma.client.enrollment.groupBy({ by: ['groupId'], where: { tenantId, status: { in: ['PENDING', 'ACTIVE'] } }, _count: { _all: true } }),
    ])
    const seatMap = new Map(seats.map((s) => [s.groupId, s._count._all]))
    // The teacher's own profile travels with the workspace so the studio never depends on the (cached) public catalog.
    const own = actor.teacherProfileId ? await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, id: actor.teacherProfileId } }) : null
    return {
      teacher: own ? toTeacher(own) : null,
      courses: courses.map((c) => toCourse(c, seatMap)),
      videos: videos.map(toVideo),
      playlists: playlists.map(toPlaylist),
      resources: resources.map(toResource),
      subjects: subjects.map((s) => ({ id: s.id, teacherId: s.teacherId, name: s.name, description: s.description })),
    }
  }

  // ───────── courses ─────────
  async createCourse(tenantId: string, actor: RequestActor, input: z.infer<typeof CourseInput>) {
    const teacherId = this.resolveTeacherId(actor, input.teacherId)
    const perms = await this.teacherPermissions(tenantId)
    if (!this.isAdmin(actor) && !perms.editCourses) throw AppError.forbidden('Teachers cannot edit courses in this workspace')
    const slug = await this.uniqueSlug('course', tenantId, slugify(input.title.en || input.title.uz))
    const course = await this.prisma.client.course.create({
      data: {
        tenantId, slug, title: input.title as Json, categoryId: input.categoryId, centerId: input.centerId, teacherId, subjectId: input.subjectId ?? null,
        summary: input.summary as Json, description: input.description as Json, curriculum: input.curriculum as Json, level: up(input.level), durationMonths: input.durationMonths,
        priceMinor: somToTiyin(input.price), coverSeed: input.coverSeed ?? Math.floor(Math.random() * 1000), imageUrl: input.imageUrl ?? null, meyosGrant: this.isAdmin(actor) ? (input.meyosGrant ?? false) : false,
        createdById: actor.id, ...this.publishableData(input, actor, !!perms.publishDirectly),
      } as Prisma.CourseUncheckedCreateInput,
      include: { groups: true },
    })
    await this.audit.record({ action: 'course.create', entityType: 'Course', entityId: course.id, after: { slug } })
    return toCourse(course)
  }

  async updateCourse(tenantId: string, actor: RequestActor, id: string, input: z.infer<typeof CoursePatch>) {
    const course = await this.prisma.client.course.findFirst({ where: { tenantId, id } })
    if (!course) throw AppError.notFound('Course')
    this.assertTeacherScope(actor, course)
    const perms = await this.teacherPermissions(tenantId)
    if (!this.isAdmin(actor)) {
      if (!perms.editCourses) throw AppError.forbidden('Teachers cannot edit courses in this workspace')
      if (input.price !== undefined && !perms.editPrices) throw AppError.forbidden('Price changes require Super Admin')
      if (input.meyosGrant !== undefined) delete input.meyosGrant
    }
    const data: Record<string, unknown> = { ...this.publishableData(input, actor, !!perms.publishDirectly), updatedById: actor.id }
    for (const k of ['title', 'summary', 'description', 'curriculum'] as const) if (input[k] !== undefined) data[k] = input[k] as Json
    for (const k of ['categoryId', 'centerId', 'subjectId', 'durationMonths', 'coverSeed', 'imageUrl', 'meyosGrant'] as const) if (input[k] !== undefined) data[k] = input[k]
    if (input.teacherId && this.isAdmin(actor)) data.teacherId = input.teacherId
    if (input.level) data.level = up(input.level)
    if (input.price !== undefined) data.priceMinor = somToTiyin(input.price)
    const updated = await this.prisma.client.course.update({ where: { id }, data: data as Prisma.CourseUncheckedUpdateInput, include: { groups: { where: { deletedAt: null } } } })
    await this.audit.record({ action: 'course.update', entityType: 'Course', entityId: id, before: { status: course.status, priceMinor: course.priceMinor }, after: { status: updated.status, priceMinor: updated.priceMinor } })
    return toCourse(updated)
  }

  async deleteCourse(tenantId: string, actor: RequestActor, id: string) {
    const course = await this.prisma.client.course.findFirst({ where: { tenantId, id }, include: { groups: { where: { deletedAt: null }, select: { id: true } } } })
    if (!course) throw AppError.notFound('Course')
    this.assertTeacherScope(actor, course)
    const enrolled = await this.prisma.client.enrollment.count({ where: { tenantId, groupId: { in: course.groups.map((g) => g.id) }, status: { in: ['PENDING', 'ACTIVE'] } } })
    if (enrolled > 0) throw AppError.conflict('has_enrollments', 'Archive the course instead: students are enrolled in its groups')
    await this.prisma.client.course.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } })
    await this.audit.record({ action: 'course.delete', entityType: 'Course', entityId: id })
    return { ok: true }
  }

  // ───────── groups (capacity + schedule) ─────────
  async createGroup(tenantId: string, actor: RequestActor, courseId: string, input: GroupInput) {
    const course = await this.prisma.client.course.findFirst({ where: { tenantId, id: courseId } })
    if (!course) throw AppError.notFound('Course')
    this.assertTeacherScope(actor, course)
    const perms = await this.teacherPermissions(tenantId)
    if (!this.isAdmin(actor) && !perms.manageGroups) throw AppError.forbidden('Group management is disabled for teachers')
    const group = await this.prisma.client.group.create({ data: { tenantId, courseId, name: input.name, days: input.days, startTime: input.start, endTime: input.end, room: input.room, capacity: input.capacity } })
    await this.sessions.generateForGroup(group, this.sessions.todayLocal(), 28, `user:${actor.id}`)
    await this.audit.record({ action: 'group.create', entityType: 'Group', entityId: group.id, after: { capacity: group.capacity, days: group.days } })
    return toGroup(group)
  }

  async updateGroup(tenantId: string, actor: RequestActor, id: string, input: Partial<GroupInput>) {
    const group = await this.prisma.client.group.findFirst({ where: { tenantId, id }, include: { course: true } })
    if (!group) throw AppError.notFound('Group')
    this.assertTeacherScope(actor, group.course)
    const perms = await this.teacherPermissions(tenantId)
    if (!this.isAdmin(actor)) {
      if (!perms.manageGroups) throw AppError.forbidden('Group management is disabled for teachers')
      if ((input.days || input.start || input.end) && !perms.editSchedules) throw AppError.forbidden('Schedule changes require Super Admin')
    }
    const enrolled = await this.prisma.client.enrollment.count({ where: { tenantId, groupId: id, status: { in: ['PENDING', 'ACTIVE'] } } })
    if (input.capacity !== undefined) {
      const check = validateCapacity(input.capacity, enrolled)
      if (!check.ok) throw AppError.invalid(`capacity-${check.reason}`, check.reason === 'below-enrolled' ? `Capacity cannot be below the current enrollment (${enrolled})` : 'Capacity must be a positive whole number', { enrolled })
    }
    // Validate effective schedule using DB fallback for any unset field in the patch.
    const effectiveStart = input.start ?? group.startTime
    const effectiveEnd = input.end ?? group.endTime
    if ((input.start !== undefined || input.end !== undefined) && effectiveStart >= effectiveEnd)
      throw AppError.invalid('invalid_schedule', 'start time must be before end time', { start: effectiveStart, end: effectiveEnd })
    const scheduleChanged = !!(input.days || input.start || input.end)
    const updated = await this.prisma.client.group.update({
      where: { id },
      data: { name: input.name, days: input.days, startTime: input.start, endTime: input.end, room: input.room, capacity: input.capacity },
    })
    if (scheduleChanged) {
      // Future scheduled sessions without attendance are regenerated; past ones are history and stay.
      const today = this.sessions.todayLocal()
      const future = await this.prisma.client.lessonSession.findMany({ where: { groupId: id, status: 'SCHEDULED', date: { gte: new Date(`${today}T00:00:00Z`) }, attendance: { none: {} } }, select: { id: true } })
      if (future.length) await this.prisma.client.lessonSession.deleteMany({ where: { id: { in: future.map((f) => f.id) } } })
      await this.sessions.generateForGroup(updated, addDays(today, 0), 28, `user:${actor.id}`)
    }
    await this.audit.record({ action: 'group.update', entityType: 'Group', entityId: id, before: { capacity: group.capacity, days: group.days, start: group.startTime, end: group.endTime }, after: { capacity: updated.capacity, days: updated.days, start: updated.startTime, end: updated.endTime } })
    return toGroup(updated)
  }

  async deleteGroup(tenantId: string, actor: RequestActor, id: string) {
    const group = await this.prisma.client.group.findFirst({ where: { tenantId, id }, include: { course: true } })
    if (!group) throw AppError.notFound('Group')
    this.assertTeacherScope(actor, group.course)
    const enrolled = await this.prisma.client.enrollment.count({ where: { tenantId, groupId: id, status: { in: ['PENDING', 'ACTIVE'] } } })
    if (enrolled > 0) throw AppError.conflict('has_enrollments', 'A group with enrolled students cannot be deleted')
    await this.prisma.client.group.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.prisma.client.lessonSession.updateMany({ where: { groupId: id, status: 'SCHEDULED' }, data: { status: 'CANCELLED', attendanceOpen: false, attendanceTokenHash: null } })
    await this.audit.record({ action: 'group.delete', entityType: 'Group', entityId: id })
    return { ok: true }
  }

  async myGroups(tenantId: string, actor: RequestActor) {
    const where = this.isAdmin(actor) ? { tenantId } : this.isCenterAdmin(actor) ? { tenantId, course: { centerId: actor.centerId ?? '__none__' } } : { tenantId, course: { teacherId: actor.teacherProfileId ?? '__none__' } }
    const groups = await this.prisma.client.group.findMany({ where, include: { course: { select: { id: true, title: true, teacherId: true, centerId: true } } }, orderBy: { createdAt: 'asc' } })
    const counts = await this.prisma.client.enrollment.groupBy({ by: ['groupId'], where: { tenantId, groupId: { in: groups.map((g) => g.id) }, status: 'ACTIVE' }, _count: { _all: true } })
    const map = new Map(counts.map((c) => [c.groupId, c._count._all]))
    return groups.map((g) => ({ ...toGroup(g, map), courseTitle: g.course.title, teacherId: g.course.teacherId }))
  }

  async groupDetail(tenantId: string, actor: RequestActor, id: string) {
    const group = await this.prisma.client.group.findFirst({ where: { tenantId, id }, include: { course: { include: { center: { select: { id: true, name: true } }, teacher: { select: { id: true, name: true } } } } } })
    if (!group) throw AppError.notFound('Group')
    this.assertTeacherScope(actor, group.course)
    const [roster, sessions] = await Promise.all([
      this.prisma.client.enrollment.findMany({ where: { tenantId, groupId: id, status: 'ACTIVE' }, include: { student: { select: { id: true, displayName: true, district: true } }, subscription: { select: { packageId: true, startedAt: true, package: { select: { name: true } } } } }, orderBy: { enrolledAt: 'asc' } }),
      this.prisma.client.lessonSession.findMany({ where: { tenantId, groupId: id }, orderBy: { startsAt: 'asc' }, include: { attendance: { select: { studentId: true, status: true, checkedInAt: true, method: true } } } }),
    ])
    return {
      group: toGroup(group, new Map([[group.id, roster.length]])),
      course: { id: group.course.id, title: group.course.title, teacher: group.course.teacher, center: group.course.center },
      roster: roster.map((e) => ({ id: e.student.id, displayName: e.student.displayName, district: e.student.district, packageId: e.subscription.packageId, packageName: e.subscription.package?.name, since: e.subscription.startedAt ?? e.enrolledAt })),
      sessions: sessions.map((s) => ({ ...SessionsService.toDto(s), records: s.attendance.map((a) => ({ studentId: a.studentId, status: a.status.toLowerCase(), method: a.method.toLowerCase(), checkedInAt: a.checkedInAt.toISOString() })) })),
    }
  }

  async generateGroupSessions(tenantId: string, actor: RequestActor, id: string, days: number) {
    const group = await this.prisma.client.group.findFirst({ where: { tenantId, id }, include: { course: true } })
    if (!group) throw AppError.notFound('Group')
    this.assertTeacherScope(actor, group.course)
    const created = await this.sessions.generateForGroup(group, this.sessions.todayLocal(), Math.min(Math.max(days, 1), 90), `user:${actor.id}`)
    return { created }
  }

  // ───────── videos / playlists / resources / subjects ─────────
  async createVideo(tenantId: string, actor: RequestActor, input: z.infer<typeof VideoInput>) {
    const teacherId = this.resolveTeacherId(actor, input.teacherId)
    const perms = await this.teacherPermissions(tenantId)
    const v = await this.prisma.client.video.create({
      data: {
        tenantId, teacherId, courseId: input.courseId ?? null, title: input.title as Json, description: input.description as Json,
        sourceKind: input.source.kind === 'upload' ? 'UPLOAD' : 'LINK', sourceUrl: input.source.kind === 'link' ? input.source.url : (input.source.url ?? null), storageKey: input.source.kind === 'upload' ? input.source.key : null,
        durationSec: input.durationSec, thumbnailUrl: input.thumbnailUrl ?? null, coverSeed: input.coverSeed ?? Math.floor(Math.random() * 1000), ...this.publishableData(input, actor, !!perms.publishDirectly),
      } as Prisma.VideoUncheckedCreateInput,
    })
    return toVideo(v)
  }
  async updateVideo(tenantId: string, actor: RequestActor, id: string, input: z.infer<typeof VideoInput>) {
    const v = await this.prisma.client.video.findFirst({ where: { tenantId, id } })
    if (!v) throw AppError.notFound('Video')
    this.assertTeacherScope(actor, v)
    const perms = await this.teacherPermissions(tenantId)
    const data: Record<string, unknown> = this.publishableData(input, actor, !!perms.publishDirectly)
    if (input.title) data.title = input.title as Json
    if (input.description) data.description = input.description as Json
    if (input.courseId !== undefined) data.courseId = input.courseId
    if (input.source) { data.sourceKind = input.source.kind === 'upload' ? 'UPLOAD' : 'LINK'; data.sourceUrl = input.source.kind === 'link' ? input.source.url : (input.source.url ?? null); data.storageKey = input.source.kind === 'upload' ? input.source.key : null }
    if (input.durationSec !== undefined) data.durationSec = input.durationSec
    if (input.thumbnailUrl !== undefined) data.thumbnailUrl = input.thumbnailUrl
    const updated = await this.prisma.client.video.update({ where: { id }, data: data as Prisma.VideoUncheckedUpdateInput })
    return toVideo(updated)
  }
  async deleteVideo(tenantId: string, actor: RequestActor, id: string) {
    const v = await this.prisma.client.video.findFirst({ where: { tenantId, id } })
    if (!v) throw AppError.notFound('Video')
    this.assertTeacherScope(actor, v)
    await this.prisma.client.video.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } })
    return { ok: true }
  }

  async createPlaylist(tenantId: string, actor: RequestActor, input: z.infer<typeof PlaylistInput>) {
    const teacherId = this.resolveTeacherId(actor, input.teacherId)
    const perms = await this.teacherPermissions(tenantId)
    const p = await this.prisma.client.playlist.create({
      data: { tenantId, teacherId, title: input.title as Json, description: input.description as Json, coverSeed: input.coverSeed ?? Math.floor(Math.random() * 1000), ...this.publishableData(input, actor, !!perms.publishDirectly), items: { create: input.videoIds.map((videoId, position) => ({ videoId, position })) } } as Prisma.PlaylistUncheckedCreateInput,
      include: { items: { orderBy: { position: 'asc' } } },
    })
    return toPlaylist(p)
  }
  async updatePlaylist(tenantId: string, actor: RequestActor, id: string, input: z.infer<typeof PlaylistInput>) {
    const p = await this.prisma.client.playlist.findFirst({ where: { tenantId, id } })
    if (!p) throw AppError.notFound('Playlist')
    this.assertTeacherScope(actor, p)
    const perms = await this.teacherPermissions(tenantId)
    const data: Record<string, unknown> = this.publishableData(input, actor, !!perms.publishDirectly)
    if (input.title) data.title = input.title as Json
    if (input.description) data.description = input.description as Json
    if (input.coverSeed !== undefined) data.coverSeed = input.coverSeed
    const updated = await this.prisma.tx(async (tx) => {
      if (input.videoIds) {
        await tx.playlistItem.deleteMany({ where: { playlistId: id } })
        await tx.playlistItem.createMany({ data: input.videoIds.map((videoId, position) => ({ playlistId: id, videoId, position })) })
      }
      return tx.playlist.update({ where: { id }, data: data as Prisma.PlaylistUncheckedUpdateInput, include: { items: { orderBy: { position: 'asc' } } } })
    })
    return toPlaylist(updated)
  }
  async deletePlaylist(tenantId: string, actor: RequestActor, id: string) {
    const p = await this.prisma.client.playlist.findFirst({ where: { tenantId, id } })
    if (!p) throw AppError.notFound('Playlist')
    this.assertTeacherScope(actor, p)
    await this.prisma.client.playlist.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } })
    return { ok: true }
  }

  async createResource(tenantId: string, actor: RequestActor, input: z.infer<typeof ResourceInput>) {
    const teacherId = this.resolveTeacherId(actor, input.teacherId)
    const perms = await this.teacherPermissions(tenantId)
    if (!this.isAdmin(actor) && !perms.uploadResources) throw AppError.forbidden('Resource uploads are disabled for teachers')
    const r = await this.prisma.client.resource.create({
      data: {
        tenantId, teacherId, courseId: input.courseId ?? null, title: input.title as Json, description: input.description as Json, kind: up(input.kind),
        fileName: input.file?.name ?? null, fileSize: input.file?.size ?? null, fileMime: input.file?.mime ?? null, storageKey: input.file?.key ?? null, url: input.url ?? null, pages: input.pages ?? null,
        ...this.publishableData(input, actor, !!perms.publishDirectly),
      } as Prisma.ResourceUncheckedCreateInput,
    })
    return toResource(r)
  }
  async updateResource(tenantId: string, actor: RequestActor, id: string, input: z.infer<typeof ResourceInput>) {
    const r = await this.prisma.client.resource.findFirst({ where: { tenantId, id } })
    if (!r) throw AppError.notFound('Resource')
    this.assertTeacherScope(actor, r)
    const perms = await this.teacherPermissions(tenantId)
    const data: Record<string, unknown> = this.publishableData(input, actor, !!perms.publishDirectly)
    if (input.title) data.title = input.title as Json
    if (input.description) data.description = input.description as Json
    if (input.kind) data.kind = up(input.kind)
    if (input.courseId !== undefined) data.courseId = input.courseId
    if (input.file !== undefined) { data.fileName = input.file?.name ?? null; data.fileSize = input.file?.size ?? null; data.fileMime = input.file?.mime ?? null; data.storageKey = input.file?.key ?? null }
    if (input.url !== undefined) data.url = input.url
    if (input.pages !== undefined) data.pages = input.pages
    const updated = await this.prisma.client.resource.update({ where: { id }, data: data as Prisma.ResourceUncheckedUpdateInput })
    return toResource(updated)
  }
  async deleteResource(tenantId: string, actor: RequestActor, id: string) {
    const r = await this.prisma.client.resource.findFirst({ where: { tenantId, id } })
    if (!r) throw AppError.notFound('Resource')
    this.assertTeacherScope(actor, r)
    await this.prisma.client.resource.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } })
    return { ok: true }
  }

  async upsertSubject(tenantId: string, actor: RequestActor, input: z.infer<typeof SubjectInput>, id?: string) {
    const teacherId = this.resolveTeacherId(actor, input.teacherId)
    if (id) {
      const s = await this.prisma.client.subject.findFirst({ where: { tenantId, id } })
      if (!s) throw AppError.notFound('Subject')
      this.assertTeacherScope(actor, s)
      const u = await this.prisma.client.subject.update({ where: { id }, data: { name: input.name as Json, description: input.description as Json } })
      return { id: u.id, teacherId: u.teacherId, name: u.name, description: u.description }
    }
    const c = await this.prisma.client.subject.create({ data: { tenantId, teacherId, name: input.name as Json, description: input.description as Json } })
    return { id: c.id, teacherId: c.teacherId, name: c.name, description: c.description }
  }
  async deleteSubject(tenantId: string, actor: RequestActor, id: string) {
    const s = await this.prisma.client.subject.findFirst({ where: { tenantId, id } })
    if (!s) throw AppError.notFound('Subject')
    this.assertTeacherScope(actor, s)
    await this.prisma.tx(async (tx) => {
      await tx.course.updateMany({ where: { subjectId: id }, data: { subjectId: null } })
      await tx.subject.update({ where: { id }, data: { deletedAt: new Date() } })
    })
    return { ok: true }
  }

  // ───────── admin: centers, categories, teachers, packages, users ─────────
  async upsertCenter(tenantId: string, input: z.infer<typeof import('./manage.schemas').CenterInput>, id?: string) {
    const data = { name: input.name, district: input.district as Json, description: input.description as Json, tone: input.tone, address: input.address ?? null }
    if (id) return this.prisma.client.center.update({ where: { id }, data })
    return this.prisma.client.center.create({ data: { tenantId, slug: await this.uniqueSlug('center', tenantId, slugify(input.name)), ...data } })
  }
  async deleteCenter(tenantId: string, id: string) {
    const used = await this.prisma.client.course.count({ where: { tenantId, centerId: id } }) + (await this.prisma.client.teacherProfile.count({ where: { tenantId, centerId: id } }))
    if (used > 0) throw AppError.conflict('in_use', 'Center has courses or teachers')
    await this.prisma.client.center.update({ where: { id }, data: { deletedAt: new Date() } })
    return { ok: true }
  }
  async upsertCategory(tenantId: string, input: z.infer<typeof import('./manage.schemas').CategoryInput>, id?: string) {
    const data = { name: input.name as Json, glyph: input.glyph, sortOrder: input.sortOrder }
    if (id) return this.prisma.client.category.update({ where: { id }, data })
    return this.prisma.client.category.create({ data: { tenantId, slug: await this.uniqueSlug('category', tenantId, slugify(input.name.en || input.name.uz)), ...data } })
  }
  async deleteCategory(tenantId: string, id: string) {
    if ((await this.prisma.client.course.count({ where: { tenantId, categoryId: id } })) > 0) throw AppError.conflict('in_use', 'Category has courses')
    await this.prisma.client.category.update({ where: { id }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  async updateOwnTeacherProfile(tenantId: string, actor: RequestActor, input: z.infer<typeof TeacherPatch>) {
    if (!actor.teacherProfileId) throw AppError.forbidden('No teacher profile linked to this account')
    return this.updateTeacherScoped(tenantId, actor, actor.teacherProfileId, input)
  }

  async updateTeacherScoped(tenantId: string, actor: RequestActor, id: string, input: z.infer<typeof TeacherPatch>) {
    const isAdm = this.isAdmin(actor)
    if (!isAdm) {
      if (!actor.teacherProfileId || actor.teacherProfileId !== id) {
        throw AppError.forbidden('Cannot edit another teacher profile')
      }
      const perms = await this.teacherPermissions(tenantId)
      if (!perms.customizeChannel) {
        throw AppError.forbidden('Teacher profile customization is disabled in this workspace')
      }
    }
    return this.upsertTeacher(tenantId, actor, input, id)
  }

  async generateAvatarUploadUrl(tenantId: string, actor: RequestActor, input: z.infer<typeof AvatarUploadUrlInput>) {
    if (!actor.teacherProfileId && !this.isAdmin(actor)) {
      throw AppError.forbidden('No teacher profile linked to this account')
    }
    if (!this.isAdmin(actor)) {
      const perms = await this.teacherPermissions(tenantId)
      if (!perms.customizeChannel) {
        throw AppError.forbidden('Teacher profile customization is disabled in this workspace')
      }
    }
    if (!s3Configured(this.env)) {
      throw AppError.invalid('storage_not_configured', 'Object storage (S3) is not configured in this environment.')
    }
    const s3 = new S3Client({
      endpoint: this.env.S3_ENDPOINT,
      region: this.env.S3_REGION,
      credentials: {
        accessKeyId: this.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: this.env.S3_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
    })
    const ext = input.contentType === 'image/webp' ? 'webp' : input.contentType === 'image/png' ? 'png' : 'jpg'
    const profileId = actor.teacherProfileId ?? 'admin'
    const key = `avatars/${tenantId}/${profileId}-${Date.now()}.${ext}`
    const command = new PutObjectCommand({
      Bucket: this.env.S3_BUCKET,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.fileSize,
    })
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 })
    const baseUrl = this.env.S3_PUBLIC_BASE_URL ?? (this.env.S3_ENDPOINT ? `${this.env.S3_ENDPOINT}/${this.env.S3_BUCKET}` : '')
    const publicUrl = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/${key}` : `/${key}`
    return { uploadUrl, publicUrl, key }
  }

  async upsertTeacher(tenantId: string, actor: RequestActor, input: z.infer<typeof TeacherInput> | z.infer<typeof TeacherPatch>, id?: string) {
    const isAdm = this.isAdmin(actor)
    const base: Record<string, unknown> = {}
    for (const k of ['name', 'expertise', 'avatarSeed', 'bannerTone', 'avatarUrl', 'bannerUrl', 'channelActive'] as const) {
      if (input[k] !== undefined) base[k] = input[k]
    }
    for (const k of ['title', 'bio', 'tagline'] as const) {
      if (input[k] !== undefined) base[k] = input[k] as Json
    }
    if (isAdm && input.centerId !== undefined) {
      base.centerId = input.centerId
    }

    if (id) {
      const existing = await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, id } })
      if (!existing) throw AppError.notFound('TeacherProfile')

      if (!isAdm) {
        if (input.centerId !== undefined && input.centerId !== existing.centerId) {
          throw AppError.forbidden('Only administrators can change center affiliation')
        }
        if (input.phone !== undefined) {
          throw AppError.forbidden('Only administrators can change account links')
        }
        if (input.featured !== undefined && input.featured !== null) {
          if (input.featured.type === 'course') {
            const course = await this.prisma.client.course.findFirst({
              where: { tenantId, id: input.featured.id, teacherId: id },
            })
            if (!course) throw AppError.invalid('invalid_featured', 'Featured course must belong to your profile')
          } else if (input.featured.type === 'playlist') {
            const playlist = await this.prisma.client.playlist.findFirst({
              where: { tenantId, id: input.featured.id, teacherId: id },
            })
            if (!playlist) throw AppError.invalid('invalid_featured', 'Featured playlist must belong to your profile')
          }
        }
        if (input.avatarUrl) {
          const match = input.avatarUrl.match(/(?:^|\/)avatars\/([^/]+)\/([^/]+)/)
          if (match) {
            const [, keyTenant, keyFile] = match
            if (keyTenant === tenantId && !keyFile.startsWith(`${id}-`)) {
              throw AppError.forbidden('Cannot use an avatar image belonging to another teacher')
            }
          }
        }
      }

      if (input.featured !== undefined) {
        base.featuredType = input.featured?.type ?? null
        base.featuredId = input.featured?.id ?? null
      }

      let userId: string | undefined
      if (input.phone && isAdm) {
        const phone = normalizeUzPhone(input.phone)
        if (!phone.ok) throw AppError.invalid('invalid_phone', 'Invalid phone number')
        const user = await this.prisma.client.user.upsert({
          where: { tenantId_phoneE164: { tenantId, phoneE164: phone.e164 } },
          update: {},
          create: { tenantId, phoneE164: phone.e164, displayName: (input as { name?: string }).name ?? phone.e164, roles: ['TEACHER', 'STUDENT'] },
        })
        if (!user.roles.includes('TEACHER')) await this.prisma.client.user.update({ where: { id: user.id }, data: { roles: [...user.roles, 'TEACHER'] } })
        userId = user.id
        await this.audit.record({ action: 'teacher.link_user', entityType: 'User', entityId: user.id, after: { teacherProfile: id ?? 'new' } })
      }

      if (input.name && existing.userId) {
        await this.prisma.client.user.update({
          where: { id: existing.userId },
          data: { displayName: input.name },
        }).catch(() => undefined)
      }
      const t = await this.prisma.client.teacherProfile.update({ where: { id }, data: { ...base, ...(userId ? { userId } : {}) } as Prisma.TeacherProfileUncheckedUpdateInput })
      return toTeacher(t)
    }

    if (!isAdm) {
      throw AppError.forbidden('Only administrators can create new teacher profiles')
    }

    const full = input as z.infer<typeof TeacherInput>
    let userId: string | undefined
    if (full.phone) {
      const phone = normalizeUzPhone(full.phone)
      if (!phone.ok) throw AppError.invalid('invalid_phone', 'Invalid phone number')
      const user = await this.prisma.client.user.upsert({
        where: { tenantId_phoneE164: { tenantId, phoneE164: phone.e164 } },
        update: {},
        create: { tenantId, phoneE164: phone.e164, displayName: full.name ?? phone.e164, roles: ['TEACHER', 'STUDENT'] },
      })
      if (!user.roles.includes('TEACHER')) await this.prisma.client.user.update({ where: { id: user.id }, data: { roles: [...user.roles, 'TEACHER'] } })
      userId = user.id
    }
    if (full.featured !== undefined) {
      base.featuredType = full.featured?.type ?? null
      base.featuredId = full.featured?.id ?? null
    }

    const t = await this.prisma.client.teacherProfile.create({
      data: { tenantId, slug: await this.uniqueSlug('teacher', tenantId, slugify(full.name)), name: full.name, title: full.title as Json, bio: full.bio as Json, expertise: full.expertise, centerId: full.centerId, tagline: full.tagline as Json, ...base, userId } as Prisma.TeacherProfileUncheckedCreateInput,
    })
    void actor
    return toTeacher(t)
  }
  async deleteTeacher(tenantId: string, id: string) {
    if ((await this.prisma.client.course.count({ where: { tenantId, teacherId: id } })) > 0) throw AppError.conflict('in_use', 'Teacher has courses')
    await this.prisma.client.teacherProfile.update({ where: { id }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  async upsertPackage(tenantId: string, input: z.infer<typeof PackageInput> | z.infer<typeof import('./manage.schemas').PackagePatch>, id?: string) {
    const data: Record<string, unknown> = {}
    for (const k of ['code', 'maxCourses', 'enabled', 'highlight', 'sortOrder'] as const) if (input[k] !== undefined) data[k] = input[k]
    for (const k of ['name', 'description', 'perks'] as const) if (input[k] !== undefined) data[k] = input[k] as Json
    if (id) return this.prisma.client.package.update({ where: { id }, data: data as Prisma.PackageUncheckedUpdateInput })
    return this.prisma.client.package.create({ data: { tenantId, ...data } as Prisma.PackageUncheckedCreateInput })
  }

  async listUsers(tenantId: string, q: { role?: string; search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1), pageSize = Math.min(200, Math.max(10, q.pageSize ?? 50))
    const where = { tenantId, ...(q.role ? { roles: { has: q.role as 'STUDENT' } } : {}), ...(q.search ? { OR: [{ displayName: { contains: q.search, mode: 'insensitive' as const } }, { phoneE164: { contains: q.search.replace(/\D/g, '') } }] } : {}) }
    const [rows, total] = await Promise.all([
      this.prisma.client.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { teacherProfile: { select: { id: true } }, subscriptions: { where: { status: { in: ['ACTIVE', 'PENDING_PAYMENT', 'PAST_DUE'] } }, select: { id: true, status: true, packageId: true, startedAt: true, currentPeriodEnd: true }, take: 1 }, enrollments: { where: { status: 'ACTIVE' }, select: { groupId: true } } } }),
      this.prisma.client.user.count({ where }),
    ])
    return { page, pageSize, total, items: rows.map((u) => ({ id: u.id, phoneMasked: u.phoneE164 ? u.phoneE164.replace(/(\+998\d{2})\d{5}(\d{2})/, '$1*****$2') : null, login: u.login, displayName: u.displayName, district: u.district, preferredLang: u.preferredLang, roles: u.roles, centerId: u.centerId, isActive: u.isActive, teacherProfileId: u.teacherProfile?.id ?? null, subscription: u.subscriptions[0] ?? null, groupIds: u.enrollments.map((e) => e.groupId), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt })) }
  }

  async setRoles(tenantId: string, actor: RequestActor, userId: string, input: z.infer<typeof UserRolesInput>) {
    const user = await this.prisma.client.user.findFirst({ where: { tenantId, id: userId } })
    if (!user) throw AppError.notFound('User')
    // Super Admin belongs to the configured owner only (owner-setup command) and is never granted or revoked here.
    const tenant = await TenantContext.system(() => this.prisma.client.tenant.findUnique({ where: { id: tenantId }, select: { ownerUserId: true } }))
    if (tenant?.ownerUserId === user.id) throw AppError.forbidden('The owner account cannot be changed here', { code: 'owner_protected' })
    void actor
    const updated = await this.prisma.client.user.update({ where: { id: userId }, data: { roles: input.roles, centerId: input.centerId === undefined ? user.centerId : input.centerId, isActive: input.isActive ?? user.isActive } })
    await this.audit.record({ action: 'user.roles', entityType: 'User', entityId: userId, before: { roles: user.roles, centerId: user.centerId, isActive: user.isActive }, after: { roles: updated.roles, centerId: updated.centerId, isActive: updated.isActive }, reason: input.reason })
    return { id: updated.id, roles: updated.roles, centerId: updated.centerId, isActive: updated.isActive }
  }

  async updateStudent(tenantId: string, userId: string, input: z.infer<typeof import('./manage.schemas').StudentAdminInput>) {
    // Verify the user belongs to this tenant before updating; prevents cross-tenant writes.
    const existing = await this.prisma.client.user.findFirst({ where: { tenantId, id: userId }, select: { id: true } })
    if (!existing) throw AppError.notFound('User')
    const u = await this.prisma.client.user.update({ where: { id: userId }, data: input })
    return { id: u.id, displayName: u.displayName, district: u.district, preferredLang: u.preferredLang }
  }

  async reviewQueue(tenantId: string) {
    const [courses, videos, playlists, resources] = await Promise.all([
      this.prisma.client.course.findMany({ where: { tenantId, reviewRequested: true }, include: { groups: true } }),
      this.prisma.client.video.findMany({ where: { tenantId, reviewRequested: true } }),
      this.prisma.client.playlist.findMany({ where: { tenantId, reviewRequested: true }, include: { items: true } }),
      this.prisma.client.resource.findMany({ where: { tenantId, reviewRequested: true } }),
    ])
    return { courses: courses.map((c) => toCourse(c)), videos: videos.map(toVideo), playlists: playlists.map(toPlaylist), resources: resources.map(toResource) }
  }

  async audits(tenantId: string, q: { entityType?: string; entityId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1), pageSize = Math.min(200, Math.max(10, q.pageSize ?? 50))
    const where = { tenantId, ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) }
    const [items, total] = await Promise.all([
      this.prisma.client.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { actor: { select: { id: true, displayName: true } } } }),
      this.prisma.client.auditEvent.count({ where }),
    ])
    return { page, pageSize, total, items }
  }

  async listInquiries(tenantId: string, q: { page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1), pageSize = Math.min(100, Math.max(10, q.pageSize ?? 50))
    const where = { tenantId }
    const [items, total] = await Promise.all([
      this.prisma.client.centerInquiry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.client.centerInquiry.count({ where }),
    ])
    return { page, pageSize, total, items }
  }

  async toggleInquiryHandled(tenantId: string, id: string) {
    const existing = await this.prisma.client.centerInquiry.findFirst({ where: { tenantId, id } })
    if (!existing) throw AppError.notFound('Inquiry')
    const updated = await this.prisma.client.centerInquiry.update({
      where: { id },
      data: { handledAt: existing.handledAt ? null : new Date() },
    })
    return { id: updated.id, handledAt: updated.handledAt }
  }

  private async uniqueSlug(kind: 'course' | 'center' | 'category' | 'teacher', tenantId: string, base: string): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`
      const exists = kind === 'course' ? await this.prisma.client.course.findFirst({ where: { tenantId, slug }, includeDeleted: true } as never)
        : kind === 'center' ? await this.prisma.client.center.findFirst({ where: { tenantId, slug }, includeDeleted: true } as never)
        : kind === 'category' ? await this.prisma.client.category.findFirst({ where: { tenantId, slug }, includeDeleted: true } as never)
        : await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, slug }, includeDeleted: true } as never)
      if (!exists) return slug
    }
    return `${base}-${Date.now().toString(36)}`
  }
}
