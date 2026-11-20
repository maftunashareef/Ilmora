import { Inject, Injectable } from '@nestjs/common'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { presignPut, s3ClientConfig } from '../../infra/storage/s3-client'
import type { z } from 'zod'
import { checkCoursePrice, COMMISSION_DEFAULT_PERCENT, isSafeExternalUrl, maxDiscountPercent, MIN_COURSE_PRICE_SOM, MIN_DISCOUNT_PERCENT, normalizeUzPhone, somToTiyin, validateCapacity, DEFAULT_COURSE_PRICE_SOM } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { addDays } from '../../common/time'
import { ENV, type Env, s3Configured } from '../../config/env'
import type { Prisma } from '../../generated/prisma/client'
import { unclaimCompany } from '../companies/companies.service'
import { unclaimInstitution } from '../institutions/institutions.service'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { discountWindow, toCourse, toGroup, toPlaylist, toResource, toTeacher, toVideo } from '../catalog/catalog.service'
import { NotificationsService } from '../notifications/notifications.service'
import { SessionsService } from '../sessions/sessions.service'
import { SiteService } from '../site/site.service'
import { lockConsents } from '../students/students.service'
import { ONLINE_PROVIDER } from './online-provider'
import type { AvatarUploadUrlInput, CenterStatusInput, CourseInput, CoursePatch, GroupInput, PackageInput, PlaylistInput, PublishableInput, ResourceInput, SubjectInput, TeacherInput, TeacherPatch, UserRolesInput, VideoInput } from './manage.schemas'
import { Role } from '../../generated/prisma/enums'

/** What a finance admin reads in the audit log: the money records only. */
const FINANCE_AUDIT_ENTITIES = ['Payment', 'Subscription', 'RefundRequest']

type Json = Prisma.InputJsonValue
const up = <T extends string>(v: T) => v.toUpperCase()
const slugify = (s: string) => s.toLowerCase().replace(/ş/g, 'sh').replace(/ç/g, 'ch').normalize('NFKD').replace(/[‘’'`ʻ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item'
/** Everything a center may do with its own courses and groups, whatever the teacher switches say. */
const CENTER_OWNER_PERMS = { customizeChannel: false, editCourses: true, editPrices: true, editSchedules: true, manageGroups: true, publishDirectly: true, uploadResources: false }

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
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private isAdmin(actor: RequestActor) { return actor.roles.includes('PLATFORM_ADMIN') }
  private isCenterAdmin(actor: RequestActor) { return actor.roles.includes('CENTER_ADMIN') }
  /** A center administrator acting on their own center's course. */
  private isCenterOwner(actor: RequestActor, centerId: string | null | undefined) { return this.isCenterAdmin(actor) && !!actor.centerId && actor.centerId === centerId }
  /** Permission switches that apply to this actor for a course of `centerId`: Super Admin and the course's center bypass the teacher switches. */
  private async permsFor(tenantId: string, actor: RequestActor, centerId: string | null | undefined) {
    if (this.isAdmin(actor) || this.isCenterOwner(actor, centerId)) return CENTER_OWNER_PERMS
    return this.teacherPermissions(tenantId)
  }
  /** Courses of a pending or blocked center cannot be published; the Super Admin can still prepare them. */
  private async assertCanPublish(tenantId: string, actor: RequestActor, centerId: string, status: string | undefined) {
    if (status !== 'published' || this.isAdmin(actor)) return
    const center = await this.prisma.client.center.findFirst({ where: { tenantId, id: centerId }, select: { status: true } })
    if (center && center.status !== 'ACTIVE') throw AppError.forbidden('The center is not approved yet, so its courses cannot be published', { code: 'center_not_approved', status: center.status })
  }
  /**
   * A blocked or rejected center stops selling: its administrator and teachers can no longer create or change courses,
   * prices, discounts, groups or schedules (reads keep working). The Super Admin still can.
   */
  private async assertCenterWritable(tenantId: string, actor: RequestActor, centerId: string | null | undefined) {
    if (this.isAdmin(actor) || !centerId) return
    const center = await this.prisma.client.center.findFirst({ where: { tenantId, id: centerId }, select: { status: true } })
    if (center && (center.status === 'BLOCKED' || center.status === 'REJECTED')) throw AppError.forbidden('This center is blocked', { code: 'center_blocked' })
  }
  /** Discounts: the Super Admin, or the center admin of the course's own center. Never a teacher. */
  private canSetDiscount(actor: RequestActor, centerId: string) {
    return this.isAdmin(actor) || (this.isCenterAdmin(actor) && !!actor.centerId && actor.centerId === centerId)
  }
  private discountColumns(d: { percent: number; startsAt: string; endsAt: string } | null) {
    return d
      ? { discountPercent: d.percent, discountStartsAt: new Date(d.startsAt), discountEndsAt: new Date(d.endsAt) }
      : { discountPercent: null, discountStartsAt: null, discountEndsAt: null }
  }
  // ───────── the price calculator (ТЗ 2026-11-18, 9; Тимур, 20.11: the 5% minimum is for new courses, dates stay) ─────────

  /** ILMORA's commission K: one for every center, set by the Super Admin only. */
  async commissionPercent(tenantId: string): Promise<number> {
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: tenantId }, select: { commissionPercent: true } })
    return tenant?.commissionPercent ?? COMMISSION_DEFAULT_PERCENT
  }
  /** What the center's course form needs to show the calculator: K and the discount range 5% … 100% − K. */
  async pricing(tenantId: string) {
    const commissionPercent = await this.commissionPercent(tenantId)
    return { commissionPercent, minDiscountPercent: MIN_DISCOUNT_PERCENT, maxDiscountPercent: maxDiscountPercent(commissionPercent), minPriceSom: MIN_COURSE_PRICE_SOM }
  }
  /**
   * The Super Admin changes K (9.5): from the next payment and renewal on; payments made keep their snapshot. The change is
   * in the audit log with the old and the new value.
   */
  async setCommission(tenantId: string, actor: RequestActor, commissionPercent: number) {
    if (!this.isAdmin(actor)) throw AppError.forbidden('Only the Super Admin sets the commission')
    const before = await this.commissionPercent(tenantId)
    if (before !== commissionPercent) {
      await this.prisma.client.tenant.update({ where: { id: tenantId }, data: { commissionPercent } })
      await this.audit.record({ action: 'pricing.commission', entityType: 'Tenant', entityId: tenantId, before: { commissionPercent: before }, after: { commissionPercent } })
    }
    return this.pricing(tenantId)
  }
  /** A discount set now is from 5% (the request schema) to 100% − K: at the limit the center gets 0, never less. */
  private async assertDiscountLimit(tenantId: string, d: { percent: number } | null | undefined) {
    if (!d) return
    const max = maxDiscountPercent(await this.commissionPercent(tenantId))
    if (d.percent > max) throw AppError.invalid('discount_over_limit', `The student discount can be at most ${max}%`, { max })
  }
  /** The price of a course created with the calculator: whole thousands from 50 000 so'm, or 0 for a free course. */
  private assertCoursePrice(priceSom: number) {
    const check = checkCoursePrice(priceSom)
    if (!check.ok) throw AppError.invalid('course_price_invalid', check.reason === 'step' ? 'The price must be whole thousands of so‘m' : `The price must be at least ${MIN_COURSE_PRICE_SOM} so‘m`, { reason: check.reason, min: MIN_COURSE_PRICE_SOM })
  }
  /**
   * A paid offline course created with the calculator is published only with a student discount (5% or more) that has
   * not ended; a free course carries none. Checked when the course becomes published and when its discount changes while
   * published — not on every edit, so a discount that simply ran out does not lock the course.
   */
  private assertStudentDiscount(c: { priceRule?: number | null; learningFormat?: string | null; priceMinor: bigint; status: string; discountPercent: number | null; discountEndsAt: Date | null }) {
    if (c.priceRule !== 1 || c.learningFormat === 'ONLINE') return
    if (c.priceMinor === 0n) {
      if (c.discountPercent) throw AppError.invalid('free_course_no_discount', 'A free course has no discount')
      return
    }
    if (c.status !== 'PUBLISHED') return
    if (!c.discountPercent || !c.discountEndsAt || c.discountEndsAt.getTime() <= Date.now()) throw AppError.invalid('student_discount_required', 'A paid course is published with a student discount of 5% or more', { min: MIN_DISCOUNT_PERCENT })
  }

  /** Serializable discount for audit records. */
  private discountSummary(c: { discountPercent: number | null; discountStartsAt: Date | null; discountEndsAt: Date | null }) {
    const w = discountWindow(c)
    return w ? { percent: w.percent, startsAt: (w.startsAt as Date).toISOString(), endsAt: (w.endsAt as Date).toISOString() } : null
  }
  private sameDiscount(input: { percent: number; startsAt: string; endsAt: string } | null, stored: { discountPercent: number | null; discountStartsAt: Date | null; discountEndsAt: Date | null }) {
    const current = discountWindow(stored)
    if (!input || !current) return !input && !current
    return input.percent === current.percent && Date.parse(input.startsAt) === (current.startsAt as Date).getTime() && Date.parse(input.endsAt) === (current.endsAt as Date).getTime()
  }

  private assertTeacherScope(actor: RequestActor, item: { teacherId: string; centerId?: string | null }) {
    if (this.isAdmin(actor)) return
    if (this.isCenterAdmin(actor) && item.centerId && item.centerId === actor.centerId) return
    if (actor.teacherProfileId && actor.teacherProfileId === item.teacherId) return
    throw AppError.forbidden('You can only manage your own content')
  }

  /**
   * A teacher may link a video or resource only to a course they teach; a center admin only to a course of their
   * own center. Without this a teacher could attach their content to any course in the tenant (Ж10).
   */
  private async assertCourseLinkable(tenantId: string, actor: RequestActor, teacherId: string, courseId: string | null | undefined) {
    if (!courseId || this.isAdmin(actor)) return
    const course = await this.prisma.client.course.findFirst({ where: { tenantId, id: courseId }, select: { teacherId: true, centerId: true } })
    if (!course) throw AppError.invalid('invalid_course', 'Unknown course')
    const ownsCourse = course.teacherId === teacherId
    const centerCourse = this.isCenterAdmin(actor) && !!actor.centerId && course.centerId === actor.centerId
    if (!ownsCourse && !centerCourse) throw AppError.forbidden('You can only attach content to your own courses', { code: 'wrong_course' })
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

  private async resolveTeacherId(tenantId: string, actor: RequestActor, requested?: string): Promise<string> {
    if (this.isAdmin(actor)) {
      if (requested) return requested
      if (actor.teacherProfileId) return actor.teacherProfileId
      throw AppError.invalid('teacher_required', 'teacherId is required')
    }
    if (this.isCenterAdmin(actor)) {
      // A center acts for its own teachers only, even when the administrator also teaches somewhere else.
      const id = requested ?? actor.teacherProfileId
      if (!id) throw AppError.invalid('teacher_required', 'teacherId is required')
      const teacher = await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, id }, select: { centerId: true } })
      if (!teacher || !actor.centerId || teacher.centerId !== actor.centerId) throw AppError.forbidden('Choose a teacher of your center', { code: 'teacher_not_in_center' })
      return id
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
    // A center sees the courses that run at the center (whoever teaches them) and the content of its teachers.
    const courseWhere = teacherId ? { tenantId, teacherId } : this.isCenterAdmin(actor) ? { tenantId, centerId: actor.centerId ?? '__none__' } : { tenantId }
    const [courses, videos, playlists, resources, subjects, seats] = await Promise.all([
      this.prisma.client.course.findMany({ where: courseWhere, include: { groups: { where: { deletedAt: null } } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.video.findMany({ where, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.playlist.findMany({ where, include: { items: { orderBy: { position: 'asc' } } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.resource.findMany({ where, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.subject.findMany({ where: teacherId ? { tenantId, teacherId } : this.isCenterAdmin(actor) ? { tenantId, teacher: { centerId: actor.centerId ?? '__none__' } } : { tenantId } }),
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
  // ONLINE courses are free links to a provider's own site: Super Admin only, no groups, no price, no discount, and they
  // hang on the platform center/profile. OFFLINE courses keep the rules they always had.
  /** The platform center and profile that ONLINE courses belong to (created on first use). */
  private async ensureOnlineProvider(tenantId: string): Promise<{ centerId: string; teacherId: string }> {
    const db = this.prisma.client
    const slug = ONLINE_PROVIDER.slug
    // A deleted platform center or profile is found and restored, not created again next to it: its slug is still taken,
    // and a second one would fail on it — online courses could not be created any more (Н17).
    let center = await db.center.findFirst({ where: { tenantId, slug }, includeDeleted: true } as never) as Awaited<ReturnType<typeof db.center.findFirst>>
    if (!center) center = await db.center.create({ data: { tenantId, slug, name: ONLINE_PROVIDER.name, district: ONLINE_PROVIDER.district as Json, description: ONLINE_PROVIDER.description as Json, tone: ONLINE_PROVIDER.tone } })
    else if (center.deletedAt) center = await db.center.update({ where: { id: center.id }, data: { deletedAt: null }, includeDeleted: true } as never)
    let teacher = await db.teacherProfile.findFirst({ where: { tenantId, slug }, includeDeleted: true } as never) as Awaited<ReturnType<typeof db.teacherProfile.findFirst>>
    if (!teacher) teacher = await db.teacherProfile.create({ data: { tenantId, slug, name: ONLINE_PROVIDER.name, title: ONLINE_PROVIDER.teacherTitle as Json, bio: ONLINE_PROVIDER.description as Json, tagline: ONLINE_PROVIDER.teacherTagline as Json, centerId: center!.id, channelActive: false } })
    else if (teacher.deletedAt) teacher = await db.teacherProfile.update({ where: { id: teacher.id }, data: { deletedAt: null, centerId: center!.id }, includeDeleted: true } as never)
    if (!center || !teacher) throw new Error('Online provider could not be prepared')
    return { centerId: center.id, teacherId: teacher.id }
  }

  /** Validated columns of an ONLINE course: a plain https link and a provider are required. */
  private onlineColumns(v: { externalUrl?: string | null; providerName?: string | null; instructorName?: string | null; certificate?: string; durationText?: unknown }) {
    if (!isSafeExternalUrl(v.externalUrl)) throw AppError.invalid('external_url_required', 'An online course needs a plain https link to its course page')
    const providerName = v.providerName?.trim()
    if (!providerName) throw AppError.invalid('provider_required', 'An online course needs the provider name')
    return {
      learningFormat: 'ONLINE' as const, externalUrl: v.externalUrl as string, providerName, instructorName: v.instructorName?.trim() || null,
      certificate: (v.certificate ?? 'NONE') as 'NONE' | 'FREE' | 'PAID' | 'AVAILABLE', durationText: (v.durationText ?? { uz: '', ru: '', en: '' }) as Json,
    }
  }

  private assertOnlineIsFree(price: number | undefined, discount: unknown) {
    if (price !== undefined && price !== 0) throw AppError.invalid('online_course_is_free', 'Online courses are free: the price must be 0')
    if (discount) throw AppError.invalid('online_course_no_discount', 'Online courses are free and cannot have a discount')
  }

  private sendsOnlineFields(v: { externalUrl?: string | null; providerName?: string | null; instructorName?: string | null; certificate?: string; durationText?: unknown }) {
    return !!(v.externalUrl || v.providerName || v.instructorName || v.durationText || (v.certificate && v.certificate !== 'NONE'))
  }

  async createCourse(tenantId: string, actor: RequestActor, input: z.infer<typeof CourseInput>) {
    const online = input.learningFormat === 'ONLINE'
    let formatData: Record<string, unknown> = { learningFormat: 'OFFLINE' }
    let centerId: string
    let teacherId: string
    if (online) {
      if (!this.isAdmin(actor)) throw AppError.forbidden('Only the Super Admin can create online courses')
      formatData = this.onlineColumns(input)
      this.assertOnlineIsFree(input.price, input.discount)
      ;({ centerId, teacherId } = await this.ensureOnlineProvider(tenantId))
    } else {
      teacherId = await this.resolveTeacherId(tenantId, actor, input.teacherId)
      if (!input.centerId) throw AppError.invalid('center_required', 'centerId is required for an offline course')
      if (this.sendsOnlineFields(input)) throw AppError.invalid('online_fields_on_offline_course', 'A link, provider or certificate belongs to an online course')
      centerId = input.centerId
      if (!this.isAdmin(actor)) {
        if (this.isCenterAdmin(actor)) {
          // A center creates courses for itself only, taught by its own teachers.
          if (centerId !== actor.centerId) throw AppError.forbidden('A center can only create courses for itself', { code: 'wrong_center' })
          const teacher = await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, id: teacherId }, select: { centerId: true } })
          if (!teacher || teacher.centerId !== centerId) throw AppError.invalid('teacher_not_in_center', 'Choose a teacher of your center')
        } else {
          // A teacher creates courses for the center their profile belongs to; a profile without a center cannot host offline courses yet.
          const teacher = await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, id: teacherId }, select: { centerId: true } })
          if (!teacher) throw AppError.notFound('TeacherProfile')
          if (!teacher.centerId) throw AppError.forbidden('Your profile is not linked to a center yet', { code: 'teacher_center_required' })
          if (teacher.centerId !== centerId) throw AppError.forbidden('You can only create courses for your own center', { code: 'wrong_center' })
        }
      }
      await this.assertCenterWritable(tenantId, actor, centerId)
    }
    const perms = await this.permsFor(tenantId, actor, centerId)
    if (!this.isAdmin(actor) && !perms.editCourses) throw AppError.forbidden('Teachers cannot edit courses in this workspace')
    // Without the price switch the author's figure is ignored, like updateCourse refuses it: the course starts at the default price.
    const price = online || this.isAdmin(actor) || perms.editPrices ? input.price : DEFAULT_COURSE_PRICE_SOM
    if (input.discount && !this.canSetDiscount(actor, centerId)) throw AppError.forbidden('Only the Super Admin or the course center can set discounts')
    await this.assertCanPublish(tenantId, actor, centerId, input.status)
    // Every course created from now on follows the calculator (priceRule 1).
    if (!online) this.assertCoursePrice(price)
    await this.assertDiscountLimit(tenantId, input.discount)
    const publishable = this.publishableData(input, actor, !!perms.publishDirectly)
    const discount = this.discountColumns(input.discount ?? null)
    this.assertStudentDiscount({ priceRule: 1, learningFormat: online ? 'ONLINE' : 'OFFLINE', priceMinor: somToTiyin(price), status: (publishable.status as string | undefined) ?? 'DRAFT', discountPercent: discount.discountPercent, discountEndsAt: discount.discountEndsAt })
    const slug = await this.uniqueSlug('course', tenantId, slugify(input.title.en || input.title.uz))
    const course = await this.prisma.client.course.create({
      data: {
        ...formatData,
        tenantId, slug, title: input.title as Json, categoryId: input.categoryId, centerId, teacherId, subjectId: input.subjectId ?? null,
        summary: input.summary as Json, description: input.description as Json, curriculum: input.curriculum as Json, level: up(input.level), durationMonths: input.durationMonths,
        priceMinor: somToTiyin(price), priceRule: 1, ...discount, coverSeed: input.coverSeed ?? Math.floor(Math.random() * 1000), imageUrl: input.imageUrl ?? null, meyosGrant: this.isAdmin(actor) ? (input.meyosGrant ?? false) : false,
        createdById: actor.id, ...publishable,
      } as Prisma.CourseUncheckedCreateInput,
      include: { groups: true },
    })
    await this.audit.record({ action: 'course.create', entityType: 'Course', entityId: course.id, after: { slug, discount: input.discount ?? null } })
    return toCourse(course)
  }

  /** Center admins: the courses of their own center (matched on the course's center), newest changes first. */
  async listCenterCourses(tenantId: string, actor: RequestActor) {
    if (!actor.centerId) throw AppError.forbidden('Your account is not linked to a center', { reason: 'center_required' })
    const [center, courses] = await Promise.all([
      this.prisma.client.center.findFirst({ where: { tenantId, id: actor.centerId, deletedAt: null } }),
      this.prisma.client.course.findMany({ where: { tenantId, centerId: actor.centerId, deletedAt: null }, include: { groups: { where: { deletedAt: null } } }, orderBy: { updatedAt: 'desc' }, take: 500 }),
    ])
    if (!center) throw AppError.notFound('Center')
    return { center: { id: center.id, name: center.name }, courses: courses.map((c) => toCourse(c)), pricing: await this.pricing(tenantId) }
  }

  /**
   * Sets or removes a course discount. Allowed for the Super Admin and for the center admin of the course's own center,
   * independent of the teacher permission switches. The change applies immediately and is audited.
   */
  async setCourseDiscount(tenantId: string, actor: RequestActor, id: string, discount: { percent: number; startsAt: string; endsAt: string } | null) {
    const course = await this.prisma.client.course.findFirst({ where: { tenantId, id, deletedAt: null }, include: { groups: { where: { deletedAt: null } } } })
    if (!course) throw AppError.notFound('Course')
    if (!this.canSetDiscount(actor, course.centerId)) throw AppError.forbidden('Only the Super Admin or the center of this course can change its discount')
    await this.assertCenterWritable(tenantId, actor, course.centerId)
    if (course.learningFormat === 'ONLINE') this.assertOnlineIsFree(undefined, discount)
    if (this.sameDiscount(discount, course)) return toCourse(course)
    await this.assertDiscountLimit(tenantId, discount)
    const next = this.discountColumns(discount)
    this.assertStudentDiscount({ ...course, discountPercent: next.discountPercent, discountEndsAt: next.discountEndsAt })
    const updated = await this.prisma.client.course.update({ where: { id }, data: { ...this.discountColumns(discount), updatedById: actor.id }, include: { groups: { where: { deletedAt: null } } } })
    await this.audit.record({ action: 'course.discount', entityType: 'Course', entityId: id, before: { discount: this.discountSummary(course) }, after: { discount: this.discountSummary(updated) } })
    return toCourse(updated)
  }

  async updateCourse(tenantId: string, actor: RequestActor, id: string, input: z.infer<typeof CoursePatch>) {
    const course = await this.prisma.client.course.findFirst({ where: { tenantId, id } })
    if (!course) throw AppError.notFound('Course')
    this.assertTeacherScope(actor, course)
    await this.assertCenterWritable(tenantId, actor, course.centerId)
    const perms = await this.permsFor(tenantId, actor, course.centerId)
    if (!this.isAdmin(actor)) {
      if (!perms.editCourses) throw AppError.forbidden('Teachers cannot edit courses in this workspace')
      if (input.price !== undefined && !perms.editPrices) {
        // The form always sends the price; only a different figure is a change this role may not make.
        if (somToTiyin(input.price) !== course.priceMinor) throw AppError.forbidden('Price changes require Super Admin')
        delete input.price
      }
      if (input.meyosGrant !== undefined) delete input.meyosGrant
      // A center may hand a course to another of its teachers; teachers never reassign.
      if (input.teacherId && input.teacherId !== course.teacherId) {
        if (!this.isCenterOwner(actor, course.centerId)) throw AppError.forbidden('Only the center or the Super Admin can change the teacher of a course')
        const teacher = await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, id: input.teacherId }, select: { centerId: true } })
        if (!teacher || teacher.centerId !== course.centerId) throw AppError.invalid('teacher_not_in_center', 'Choose a teacher of your center')
      }
    }
    await this.assertCanPublish(tenantId, actor, course.centerId, input.status)
    const wasOnline = course.learningFormat === 'ONLINE'
    const isOnline = (input.learningFormat ?? course.learningFormat) === 'ONLINE'
    if (!this.isAdmin(actor) && (wasOnline || isOnline || this.sendsOnlineFields(input))) throw AppError.forbidden('Only the Super Admin can manage online courses')
    const data: Record<string, unknown> = { ...this.publishableData(input, actor, !!perms.publishDirectly), updatedById: actor.id }
    for (const k of ['title', 'summary', 'description', 'curriculum'] as const) if (input[k] !== undefined) data[k] = input[k] as Json
    for (const k of ['categoryId', 'subjectId', 'durationMonths', 'coverSeed', 'imageUrl', 'meyosGrant'] as const) if (input[k] !== undefined) data[k] = input[k]
    if (input.level) data.level = up(input.level)
    if (isOnline) {
      // Online: the platform center/profile, no price, no discount; a link and provider are required.
      if (!wasOnline) {
        const groups = await this.prisma.client.group.count({ where: { tenantId, courseId: id, deletedAt: null } })
        if (groups > 0) throw AppError.conflict('has_groups', 'Remove the course groups before making it an online course')
        Object.assign(data, await this.ensureOnlineProvider(tenantId), this.discountColumns(null))
      }
      this.assertOnlineIsFree(input.price, input.discount)
      Object.assign(data, this.onlineColumns({
        externalUrl: input.externalUrl !== undefined ? input.externalUrl : course.externalUrl,
        providerName: input.providerName !== undefined ? input.providerName : course.providerName,
        instructorName: input.instructorName !== undefined ? input.instructorName : course.instructorName,
        certificate: input.certificate ?? course.certificate,
        durationText: input.durationText !== undefined ? input.durationText : course.durationText,
      }), { priceMinor: 0n })
    } else {
      if (wasOnline) {
        // Back to offline: a real center and teacher are needed again, and the online-only columns are cleared.
        if (!input.centerId || !input.teacherId) throw AppError.invalid('center_teacher_required', 'Choose a center and a teacher to make this an offline course')
        Object.assign(data, { learningFormat: 'OFFLINE', centerId: input.centerId, teacherId: input.teacherId, externalUrl: null, providerName: null, instructorName: null, certificate: 'NONE', durationText: { uz: '', ru: '', en: '' } })
      } else {
        if (this.sendsOnlineFields(input)) throw AppError.invalid('online_fields_on_offline_course', 'A link, provider or certificate belongs to an online course')
        // The center decides who controls a course's discount, so only the Super Admin may move a course to another center.
        if (input.centerId !== undefined && input.centerId !== course.centerId) {
          if (!this.isAdmin(actor)) throw AppError.forbidden('Only the Super Admin can move a course to another center')
          data.centerId = input.centerId
        }
        if (input.teacherId && (this.isAdmin(actor) || this.isCenterOwner(actor, course.centerId))) data.teacherId = input.teacherId
      }
      if (input.price !== undefined) {
        // A course of the calculator keeps a price of whole thousands from 50 000 so'm (or 0); older courses as before.
        if (course.priceRule === 1 && somToTiyin(input.price) !== course.priceMinor) this.assertCoursePrice(input.price)
        data.priceMinor = somToTiyin(input.price)
      }
      // A discount is changed only by the Super Admin or the course's own center admin; resending the stored one is not a change.
      if (input.discount !== undefined && !this.sameDiscount(input.discount, course)) {
        if (!this.canSetDiscount(actor, course.centerId)) throw AppError.forbidden('Only the Super Admin or the course center can change discounts')
        await this.assertDiscountLimit(tenantId, input.discount)
        Object.assign(data, this.discountColumns(input.discount))
      }
      // Becoming published, or a new price or discount while published: a paid course of the calculator needs its discount.
      const after = { ...course, ...(data as Partial<typeof course>) }
      if ((data.status === 'PUBLISHED' && course.status !== 'PUBLISHED') || (after.status === 'PUBLISHED' && (data.discountPercent !== undefined || data.priceMinor !== undefined))) this.assertStudentDiscount(after)
      else if (after.priceRule === 1 && after.priceMinor === 0n && after.discountPercent) this.assertStudentDiscount(after)
    }
    const updated = await this.prisma.client.course.update({ where: { id }, data: data as Prisma.CourseUncheckedUpdateInput, include: { groups: { where: { deletedAt: null } } } })
    await this.audit.record({ action: 'course.update', entityType: 'Course', entityId: id, before: { status: course.status, priceMinor: course.priceMinor, discount: this.discountSummary(course) }, after: { status: updated.status, priceMinor: updated.priceMinor, discount: this.discountSummary(updated) } })
    return toCourse(updated)
  }

  async deleteCourse(tenantId: string, actor: RequestActor, id: string) {
    const course = await this.prisma.client.course.findFirst({ where: { tenantId, id }, include: { groups: { where: { deletedAt: null }, select: { id: true } } } })
    if (!course) throw AppError.notFound('Course')
    this.assertTeacherScope(actor, course)
    await this.assertCenterWritable(tenantId, actor, course.centerId)
    // Deleting is an edit: respect the same permission switch as create/update, which a bare delete bypassed (Ж19).
    const perms = await this.permsFor(tenantId, actor, course.centerId)
    if (!this.isAdmin(actor) && !perms.editCourses) throw AppError.forbidden('Teachers cannot edit courses in this workspace')
    const enrolled = await this.prisma.client.enrollment.count({ where: { tenantId, groupId: { in: course.groups.map((g) => g.id) }, status: { in: ['PENDING', 'ACTIVE'] } } })
    if (enrolled > 0) throw AppError.conflict('has_enrollments', 'Archive the course instead: students are enrolled in its groups')
    const groupIds = course.groups.map((g) => g.id)
    await this.prisma.client.course.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } })
    if (groupIds.length > 0) {
      // The groups go with the course, and lessons that were still to come are cancelled so nobody can open attendance on them.
      await this.prisma.client.group.updateMany({ where: { id: { in: groupIds } }, data: { deletedAt: new Date() } })
      await this.prisma.client.lessonSession.updateMany({ where: { groupId: { in: groupIds }, status: 'SCHEDULED' }, data: { status: 'CANCELLED', attendanceOpen: false, attendanceTokenHash: null } })
    }
    await this.audit.record({ action: 'course.delete', entityType: 'Course', entityId: id, after: { groups: groupIds.length } })
    return { ok: true }
  }

  // ───────── groups (capacity + schedule) ─────────
  async createGroup(tenantId: string, actor: RequestActor, courseId: string, input: GroupInput) {
    const course = await this.prisma.client.course.findFirst({ where: { tenantId, id: courseId } })
    if (!course) throw AppError.notFound('Course')
    this.assertTeacherScope(actor, course)
    await this.assertCenterWritable(tenantId, actor, course.centerId)
    if (course.learningFormat === 'ONLINE') throw AppError.invalid('online_course_has_no_groups', 'Online courses are taken on the provider’s site and have no groups')
    const perms = await this.permsFor(tenantId, actor, course.centerId)
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
    await this.assertCenterWritable(tenantId, actor, group.course.centerId)
    const perms = await this.permsFor(tenantId, actor, group.course.centerId)
    const sameDays = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((d) => b.includes(d))
    // Only a real change counts: a form that resends the same schedule must not regenerate the lessons or notify anyone.
    const scheduleChanged = (input.days !== undefined && !sameDays(input.days, group.days)) || (input.start !== undefined && input.start !== group.startTime) || (input.end !== undefined && input.end !== group.endTime)
    if (!this.isAdmin(actor)) {
      if (!perms.manageGroups) throw AppError.forbidden('Group management is disabled for teachers')
      if (scheduleChanged && !perms.editSchedules) throw AppError.forbidden('Schedule changes require Super Admin')
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
    const updated = await this.prisma.client.group.update({
      where: { id },
      data: { name: input.name, days: input.days, startTime: input.start, endTime: input.end, room: input.room, capacity: input.capacity },
    })
    if (scheduleChanged) {
      // Future scheduled sessions without attendance are regenerated; past ones, one-off lessons and moved lessons stay.
      const today = this.sessions.todayLocal()
      const future = await this.prisma.client.lessonSession.findMany({ where: { groupId: id, status: 'SCHEDULED', isExtra: false, date: { gte: new Date(`${today}T00:00:00Z`) }, attendance: { none: {} } }, select: { id: true } })
      if (future.length) await this.prisma.client.lessonSession.deleteMany({ where: { id: { in: future.map((f) => f.id) } } })
      await this.sessions.generateForGroup(updated, addDays(today, 0), 28, `user:${actor.id}`)
      await this.notifications.safely('schedule.pattern', async () => {
        const [students, teacher] = await Promise.all([this.notifications.groupStudentIds(id), this.notifications.teacherUserId(group.course.teacherId)])
        await this.notifications.notify({
          tenantId, userIds: [...students, ...(teacher ? [teacher] : [])], type: 'schedule.pattern',
          params: { courseTitle: group.course.title, courseId: group.course.id, groupName: updated.name, days: updated.days, start: updated.startTime, end: updated.endTime },
          dedupeKey: `schedule-pattern:${id}:${updated.updatedAt.toISOString()}`,
        })
      })
    }
    await this.audit.record({ action: 'group.update', entityType: 'Group', entityId: id, before: { capacity: group.capacity, days: group.days, start: group.startTime, end: group.endTime }, after: { capacity: updated.capacity, days: updated.days, start: updated.startTime, end: updated.endTime } })
    return toGroup(updated)
  }

  async deleteGroup(tenantId: string, actor: RequestActor, id: string) {
    const group = await this.prisma.client.group.findFirst({ where: { tenantId, id }, include: { course: true } })
    if (!group) throw AppError.notFound('Group')
    this.assertTeacherScope(actor, group.course)
    await this.assertCenterWritable(tenantId, actor, group.course.centerId)
    // Same as createGroup/updateGroup: deleting a group needs the manageGroups switch, which a bare delete bypassed (Ж19).
    const perms = await this.permsFor(tenantId, actor, group.course.centerId)
    if (!this.isAdmin(actor) && !perms.manageGroups) throw AppError.forbidden('Group management is disabled for teachers')
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
    await this.assertCenterWritable(tenantId, actor, group.course.centerId)
    const created = await this.sessions.generateForGroup(group, this.sessions.todayLocal(), Math.min(Math.max(days, 1), 90), `user:${actor.id}`)
    return { created }
  }

  // ───────── videos / playlists / resources / subjects ─────────
  async createVideo(tenantId: string, actor: RequestActor, input: z.infer<typeof VideoInput>) {
    const teacherId = await this.resolveTeacherId(tenantId, actor, input.teacherId)
    await this.assertCourseLinkable(tenantId, actor, teacherId, input.courseId)
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
    if (input.courseId !== undefined) await this.assertCourseLinkable(tenantId, actor, v.teacherId, input.courseId)
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
    const teacherId = await this.resolveTeacherId(tenantId, actor, input.teacherId)
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
    const teacherId = await this.resolveTeacherId(tenantId, actor, input.teacherId)
    await this.assertCourseLinkable(tenantId, actor, teacherId, input.courseId)
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
    if (input.courseId !== undefined) await this.assertCourseLinkable(tenantId, actor, r.teacherId, input.courseId)
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
    const teacherId = await this.resolveTeacherId(tenantId, actor, input.teacherId)
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
    const data = { name: input.name, ...(input.kind ? { kind: input.kind } : {}), district: input.district as Json, description: input.description as Json, tone: input.tone, address: input.address ?? null }
    if (id) return this.prisma.client.center.update({ where: { id }, data })
    return this.prisma.client.center.create({ data: { tenantId, slug: await this.uniqueSlug('center', tenantId, slugify(input.name)), ...data } })
  }
  async deleteCenter(tenantId: string, id: string) {
    const [courses, teachers, accounts] = await Promise.all([
      this.prisma.client.course.count({ where: { tenantId, centerId: id } }),
      this.prisma.client.teacherProfile.count({ where: { tenantId, centerId: id } }),
      this.prisma.client.user.count({ where: { tenantId, centerId: id } }),
    ])
    if (courses + teachers + accounts > 0) throw AppError.conflict('in_use', 'Center has courses, teachers or linked accounts')
    await this.prisma.client.center.update({ where: { id }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  /** Super Admin: every center with its approval status, counts and the account that registered it. */
  async listCenters(tenantId: string) {
    const rows = await this.prisma.client.center.findMany({
      where: { tenantId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { courses: true, teachers: true, staff: true } } },
    })
    const ownerIds = rows.map((r) => r.ownerUserId).filter((x): x is string => !!x)
    const owners = ownerIds.length ? await this.prisma.client.user.findMany({ where: { tenantId, id: { in: ownerIds } }, select: { id: true, login: true, displayName: true, phoneE164: true } }) : []
    const ownerOf = new Map(owners.map((o) => [o.id, o]))
    return rows.map((c) => {
      const owner = c.ownerUserId ? ownerOf.get(c.ownerUserId) : undefined
      return {
        id: c.id, slug: c.slug, name: c.name, kind: c.kind, pendingName: c.pendingName, pendingNameAt: c.pendingNameAt, district: c.district, description: c.description, tone: c.tone, address: c.address, phone: c.phoneE164,
        status: c.status, approvedAt: c.approvedAt, blockedAt: c.blockedAt, blockReason: c.blockReason, createdAt: c.createdAt,
        counts: { courses: c._count.courses, teachers: c._count.teachers, admins: c._count.staff },
        owner: owner ? { id: owner.id, login: owner.login, displayName: owner.displayName, phoneMasked: owner.phoneE164 ? owner.phoneE164.replace(/(\+998\d{2})\d{5}(\d{2})/, '$1*****$2') : null } : null,
      }
    })
  }

  /** Super Admin: apply or discard the new name an approved center asked for (the center's administrators are told). */
  async reviewCenterName(tenantId: string, actor: RequestActor, id: string, approve: boolean) {
    const center = await this.prisma.client.center.findFirst({ where: { tenantId, id } })
    if (!center) throw AppError.notFound('Center')
    if (!center.pendingName) throw AppError.conflict('no_pending_name', 'The center has not asked for a new name')
    const updated = await this.prisma.client.center.update({ where: { id }, data: { ...(approve ? { name: center.pendingName } : {}), pendingName: null, pendingNameAt: null } })
    await this.audit.record({ action: approve ? 'center.rename_approve' : 'center.rename_reject', entityType: 'Center', entityId: id, before: { name: center.name, pendingName: center.pendingName }, after: { name: updated.name } })
    await this.notifications.safely('center.rename', async () => {
      const admins = await this.notifications.centerAdminIds(tenantId, id)
      const type = approve ? 'center.renameApproved' : 'center.renameRejected'
      await this.notifications.notify({ tenantId, userIds: admins, type, params: { centerName: updated.name, newName: center.pendingName, centerId: id }, dedupeKey: `center-${type}:${id}:${Date.now()}` })
    })
    void actor
    return { id: updated.id, name: updated.name, pendingName: null }
  }

  /** Super Admin: approve, block or reopen a center. The center's administrators are told; blocked centers vanish from the catalog. */
  async setCenterStatus(tenantId: string, actor: RequestActor, id: string, input: z.infer<typeof CenterStatusInput>) {
    const center = await this.prisma.client.center.findFirst({ where: { tenantId, id } })
    if (!center) throw AppError.notFound('Center')
    if (center.status === input.status) return { id: center.id, status: center.status }
    const now = new Date()
    const updated = await this.prisma.client.center.update({
      where: { id },
      data: {
        status: input.status,
        ...(input.status === 'ACTIVE' ? { approvedAt: center.approvedAt ?? now, blockedAt: null, blockReason: null } : {}),
        ...(input.status === 'BLOCKED' ? { blockedAt: now, blockReason: input.reason ?? null } : {}),
        ...(input.status === 'REJECTED' ? { blockedAt: now, blockReason: input.reason ?? null, approvedAt: null } : {}),
        ...(input.status === 'PENDING' ? { blockedAt: null, blockReason: null } : {}),
      },
    })
    await this.audit.record({ action: 'center.status', entityType: 'Center', entityId: id, before: { status: center.status }, after: { status: updated.status }, reason: input.reason })
    await this.notifications.safely('center.status', async () => {
      const admins = await this.notifications.centerAdminIds(tenantId, id)
      const type = input.status === 'ACTIVE' ? 'center.approved' : input.status === 'BLOCKED' ? 'center.blocked' : input.status === 'REJECTED' ? 'center.rejected' : 'center.pending'
      await this.notifications.notify({ tenantId, userIds: admins, type, params: { centerName: center.name, centerId: id, reason: input.reason ?? null }, dedupeKey: `center-${type}:${id}:${now.toISOString()}` })
    })
    void actor
    return { id: updated.id, status: updated.status, approvedAt: updated.approvedAt, blockedAt: updated.blockedAt, blockReason: updated.blockReason }
  }

  /**
   * Super Admin: delete an account. Soft delete: the row stays for audit and history (attendance, payments), sessions are
   * revoked, the subscription is cancelled (seats released), the login and phone are freed, a teacher profile is unlinked.
   */
  async deleteUser(tenantId: string, actor: RequestActor, userId: string, reason: string) {
    const user = await this.prisma.client.user.findFirst({ where: { tenantId, id: userId }, include: { teacherProfile: { select: { id: true } } } })
    if (!user) throw AppError.notFound('User')
    if (user.isOwner) throw AppError.forbidden('The owner account cannot be deleted here', { code: 'owner_protected' })
    if (user.id === actor.id) throw AppError.forbidden('You cannot delete your own account', { code: 'self_delete' })
    const now = new Date()
    await this.prisma.tx(async (tx) => {
      await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, revokedReason: 'account_deleted' } })
      const subs = await tx.subscription.findMany({ where: { tenantId, studentId: userId, status: { in: ['DRAFT', 'PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE'] } }, select: { id: true } })
      for (const s of subs) {
        await tx.enrollment.updateMany({ where: { subscriptionId: s.id, status: { in: ['PENDING', 'ACTIVE'] } }, data: { status: 'CANCELLED', cancelledAt: now } })
        await tx.payment.updateMany({ where: { subscriptionId: s.id, state: 'PENDING' }, data: { state: 'CANCELLED', cancelledAt: now } })
        await tx.subscription.update({ where: { id: s.id }, data: { status: 'CANCELLED', cancelledAt: now } })
      }
// The profile may be soft-deleted already (deleteTeacher keeps its userId): unlink it all the same (review 11.11).
      if (user.teacherProfile) await tx.teacherProfile.update({ where: { id: user.teacherProfile.id }, data: { userId: null }, includeDeleted: true } as never)
      // A representative's institution or company is let go with the account (№84): it used to stay held by a deleted
      // account forever — nobody could claim it, «Отвязать» answered 404. The company's students' data goes with it.
      if (user.institutionId) await unclaimInstitution(tx, user.institutionId)
      if (user.companyId) await unclaimCompany(tx, user.companyId, now)
      // A student's consents in force end with the account (ТЗ 8): each row gets the date of the deletion and stays in
      // the journal — nothing is deleted. Under the journal lock, so a consent being given at this moment is closed too
      // or refused (giveConsent reads the account under the same lock). Disabling an account (isActive) leaves them as they are.
      await lockConsents(tx, userId)
      await tx.studentConsent.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })
      // The copies of the contacts the student opened are personal data and go with the consents, as on «Отозвать доступ»
      // (ContactsService.revoke): opened requests become WITHDRAWN and lose the copy. Any copy left on another row is
      // erased too. Applications to vacancies keep their rows (the company's history of answers) but lose the copy.
      await tx.contactRequest.updateMany({ where: { userId, status: 'ACCEPTED' }, data: { status: 'WITHDRAWN', decidedAt: now, sharedName: null, sharedPhone: null, sharedEmail: null } })
      await tx.contactRequest.updateMany({ where: { userId, OR: [{ sharedName: { not: null } }, { sharedPhone: { not: null } }, { sharedEmail: { not: null } }] }, data: { sharedName: null, sharedPhone: null, sharedEmail: null } })
      await tx.vacancyApplication.updateMany({ where: { userId, OR: [{ sharedName: { not: null } }, { sharedPhone: { not: null } }, { sharedEmail: { not: null } }] }, data: { sharedName: null, sharedPhone: null, sharedEmail: null } })
      await tx.user.update({ where: { id: userId }, data: { isActive: false, deletedAt: now, login: null, phoneE164: null, googleId: null, roles: [], centerId: null, institutionId: null, companyId: null } })
      await this.audit.record({ tx, tenantId, action: 'user.delete', entityType: 'User', entityId: userId, before: { login: user.login, roles: user.roles, centerId: user.centerId, institutionId: user.institutionId, companyId: user.companyId }, reason })
    })
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
    const profileId = actor.teacherProfileId ?? 'admin'
    return this.presignImageUpload(`avatars/${tenantId}/${profileId}`, input)
  }

  /** Super Admin: upload address for a university's official logo (same image types and size limit as avatars). */
  async generateUniversityLogoUploadUrl(tenantId: string, input: z.infer<typeof AvatarUploadUrlInput>) {
    return this.presignImageUpload(`universities/${tenantId}/logo`, input)
  }

  /** A presigned PUT for one image under `<prefix>-<time>.<ext>` and the public address it will have. */
  private async presignImageUpload(prefix: string, input: z.infer<typeof AvatarUploadUrlInput>) {
    if (!s3Configured(this.env)) {
      throw AppError.invalid('storage_not_configured', 'Object storage (S3) is not configured in this environment.')
    }
    const s3 = new S3Client(s3ClientConfig(this.env))
    const ext = input.contentType === 'image/webp' ? 'webp' : input.contentType === 'image/png' ? 'png' : 'jpg'
    const key = `${prefix}-${Date.now()}.${ext}`
    const command = new PutObjectCommand({
      Bucket: this.env.S3_BUCKET,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.fileSize,
    })
    const uploadUrl = await presignPut(s3, command, 900)
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
    for (const k of ['code', 'maxCourses', 'enabled', 'highlight', 'sortOrder', 'accessKind', 'periodDays', 'lessonCount'] as const) if (input[k] !== undefined) data[k] = input[k]
    for (const k of ['name', 'description', 'perks'] as const) if (input[k] !== undefined) data[k] = input[k] as Json
    if (id) {
      // A package that stops being lesson-based needs no lesson count; one that becomes lesson-based must have one.
      const current = await this.prisma.client.package.findFirst({ where: { tenantId, id }, select: { accessKind: true, lessonCount: true } })
      if (!current) throw AppError.notFound('Package')
      const kind = (data.accessKind as string | undefined) ?? current.accessKind
      const lessons = data.lessonCount !== undefined ? (data.lessonCount as number | null) : current.lessonCount
      if (kind === 'LESSONS' && !lessons) throw AppError.invalid('lesson_count_required', 'A lesson-based package needs a lesson count')
      return this.prisma.client.package.update({ where: { id }, data: data as Prisma.PackageUncheckedUpdateInput })
    }
    return this.prisma.client.package.create({ data: { tenantId, ...data } as Prisma.PackageUncheckedCreateInput })
  }

  async listUsers(tenantId: string, q: { role?: string; search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1), pageSize = Math.min(200, Math.max(10, q.pageSize ?? 50))
    // The phone clause only applies to searches that contain digits: an empty digit string would match every phone number.
    if (q.role && !(Object.values(Role) as string[]).includes(q.role)) throw AppError.invalid('validation_failed', 'Unknown role')
    const search = q.search?.trim()
    const digits = search?.replace(/\D/g, '') ?? ''
    const where = { tenantId, ...(q.role ? { roles: { has: q.role as 'STUDENT' } } : {}), ...(search ? { OR: [{ displayName: { contains: search, mode: 'insensitive' as const } }, { login: { contains: search.toLowerCase() } }, ...(digits ? [{ phoneE164: { contains: digits } }] : [])] } : {}) }
    const [rows, total] = await Promise.all([
      this.prisma.client.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { teacherProfile: { select: { id: true } }, subscriptions: { where: { status: { in: ['ACTIVE', 'PENDING_PAYMENT', 'PAST_DUE'] } }, select: { id: true, status: true, packageId: true, startedAt: true, currentPeriodEnd: true }, take: 1 }, enrollments: { where: { status: 'ACTIVE' }, select: { groupId: true } } } }),
      this.prisma.client.user.count({ where }),
    ])
    return { page, pageSize, total, items: rows.map((u) => ({ id: u.id, phoneMasked: u.phoneE164 ? u.phoneE164.replace(/(\+998\d{2})\d{5}(\d{2})/, '$1*****$2') : null, login: u.login, displayName: u.displayName, district: u.district, preferredLang: u.preferredLang, roles: u.roles, centerId: u.centerId, isActive: u.isActive, teacherProfileId: u.teacherProfile?.id ?? null, subscription: u.subscriptions[0] ?? null, groupIds: u.enrollments.map((e) => e.groupId), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt })) }
  }

  /** Counts for the admin overview. Computed in the database so they stay correct past the paginated user list. */
  async adminStats(tenantId: string) {
    const [students, activeSubscriptions, teachers] = await Promise.all([
      this.prisma.client.user.count({ where: { tenantId, roles: { has: 'STUDENT' } } }),
      this.prisma.client.subscription.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.client.teacherProfile.count({ where: { tenantId } }),
    ])
    return { students, activeSubscriptions, teachers }
  }

  async setRoles(tenantId: string, actor: RequestActor, userId: string, input: z.infer<typeof UserRolesInput>) {
    const user = await this.prisma.client.user.findFirst({ where: { tenantId, id: userId }, include: { teacherProfile: { select: { id: true } } } })
    if (!user) throw AppError.notFound('User')
    // You cannot change your own account here: it prevents locking yourself out of Super Admin by mistake.
    if (user.id === actor.id) throw AppError.forbidden('You cannot change your own roles', { code: 'self_roles' })
    const selected = [...new Set(input.roles)]
    // Super Admin is the owner flag (isOwner), from which the access token derives PLATFORM_ADMIN + FINANCE_ADMIN.
    // Granting it stores the privileged pair like owner-setup; revoking it drops PLATFORM_ADMIN from the column.
    const wantsOwner = selected.includes('PLATFORM_ADMIN')
    const roles = (wantsOwner ? [...new Set([...selected, 'FINANCE_ADMIN' as const])] : selected.filter((r) => r !== 'PLATFORM_ADMIN')) as typeof selected
    const centerId = input.centerId === undefined ? user.centerId : input.centerId
    if (centerId && centerId !== user.centerId) {
      const center = await this.prisma.client.center.findFirst({ where: { tenantId, id: centerId }, select: { id: true } })
      if (!center) throw AppError.invalid('center_not_found', 'Center not found')
    }
    // A center administrator without a center would see an empty workspace and could not be found on the center page.
    if (roles.includes('CENTER_ADMIN') && !centerId) throw AppError.invalid('center_admin_needs_center', 'Choose the center this administrator manages')
    const isActive = input.isActive ?? user.isActive
    const isOwner = wantsOwner
    // Losing the owner flag, a role, or being blocked ends the user's open sessions immediately.
    const lostAccess = (!isActive && user.isActive) || (user.isOwner && !isOwner) || user.roles.some((r) => !roles.includes(r as (typeof roles)[number]))

    const updated = await this.prisma.client.$transaction(async (tx) => {
      // Never remove the last Super Admin: the platform would have no owner and no one could grant it again from here.
      if (user.isOwner && !isOwner) {
        const owners = await tx.user.count({ where: { tenantId, isOwner: true } })
        if (owners <= 1) throw AppError.invalid('last_owner', 'At least one Super Admin must remain')
      }
      const row = await tx.user.update({ where: { id: userId }, data: { roles, centerId, isActive, isOwner } })
      // The teacher studio works through the public teacher profile; grant one with the role so the studio is usable.
      if (roles.includes('TEACHER') && !user.teacherProfile) {
        await tx.teacherProfile.create({
          data: { tenantId, userId, slug: await this.uniqueSlug('teacher', tenantId, slugify(user.login || user.displayName)), name: user.displayName, title: {}, bio: {}, tagline: {}, expertise: [], centerId: null } as Prisma.TeacherProfileUncheckedCreateInput,
        })
      }
      // Removed roles or a block must not survive in open sessions until their refresh token expires.
      if (lostAccess) await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'roles_changed' } })
      return row
    })
    await this.audit.record({ action: 'user.roles', entityType: 'User', entityId: userId, before: { roles: user.roles, centerId: user.centerId, isActive: user.isActive, isOwner: user.isOwner }, after: { roles: updated.roles, centerId: updated.centerId, isActive: updated.isActive, isOwner: updated.isOwner }, reason: input.reason })
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

  /**
   * The audit log. The Super Admin reads all of it; a finance admin only the money records (payments and
   * subscriptions) — never who opened a student's contacts, the reviews or the accounts (ТЗ 8, 9.4).
   *
   * Filters, each one narrowing (a finance admin stays within the money records whatever is asked): the entity, the
   * action, the actor, the period (`from` included, `to` not) and the company — the events that name it in
   * `after.companyId` (contact requests, views and downloads, pages of «Студенты», student cards). So «which companies
   * saw student X, and when» is entityType=User&entityId=X, and «what company Y did in a period» is companyId=Y&from=…&to=….
   */
  async audits(tenantId: string, actor: RequestActor, q: { entityType?: string; entityId?: string; action?: string; actorId?: string; companyId?: string; from?: Date; to?: Date; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1), pageSize = Math.min(200, Math.max(10, q.pageSize ?? 50))
    const financeOnly = !actor.roles.includes('PLATFORM_ADMIN')
    if (financeOnly && q.entityType && !FINANCE_AUDIT_ENTITIES.includes(q.entityType)) return { page, pageSize, total: 0, items: [] }
    const entityType = q.entityType ? q.entityType : financeOnly ? { in: FINANCE_AUDIT_ENTITIES } : undefined
    const createdAt = q.from || q.to ? { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } : undefined
    const where = { tenantId, ...(entityType ? { entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.action ? { action: q.action } : {}), ...(q.actorId ? { actorId: q.actorId } : {}), ...(createdAt ? { createdAt } : {}) }
    const include = { actor: { select: { id: true, displayName: true } } } as const
    if (q.companyId) {
      // By the company: the page's ids come from SQL written here, so that the filter is exactly the expression of the
      // index "AuditEvent_tenantId_after_companyId_createdAt_idx" (migration 20261125000100); the rows are then read as usual.
      const params: unknown[] = [tenantId, q.companyId]
      const cond = [`"tenantId" = $1`, `("after"->>'companyId') = $2`]
      const add = (sql: (n: string) => string, value: unknown) => { params.push(value); cond.push(sql(`$${params.length}`)) }
      if (typeof entityType === 'string') add((n) => `"entityType" = ${n}`, entityType)
      else if (entityType) add((n) => `"entityType" = ANY(${n}::text[])`, entityType.in)
      if (q.entityId) add((n) => `"entityId" = ${n}`, q.entityId)
      if (q.action) add((n) => `"action" = ${n}`, q.action)
      if (q.actorId) add((n) => `"actorId" = ${n}`, q.actorId)
      // "createdAt" is a timestamp without a zone holding UTC: the ISO text is read as that wall clock, whatever the session's zone.
      if (q.from) add((n) => `"createdAt" >= ${n}::timestamp`, q.from.toISOString())
      if (q.to) add((n) => `"createdAt" < ${n}::timestamp`, q.to.toISOString())
      const matching = `FROM "AuditEvent" WHERE ${cond.join(' AND ')}`
      const [{ n: total }] = await this.prisma.client.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n ${matching}`, ...params)
      const ids = (await this.prisma.client.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" ${matching} ORDER BY "createdAt" DESC, "id" DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, ...params)).map((r) => r.id)
      const rows = ids.length ? await this.prisma.client.auditEvent.findMany({ where: { tenantId, id: { in: ids } }, include }) : []
      const at = new Map(ids.map((id, i) => [id, i]))
      return { page, pageSize, total, items: rows.sort((x, y) => at.get(x.id)! - at.get(y.id)!) }
    }
    const [items, total] = await Promise.all([
      this.prisma.client.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include }),
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
