import { checkDiscount, isSafeExternalUrl, MAX_DISCOUNT_PERCENT } from '@ilmora/shared'
import { z } from 'zod'

export const L = z.object({ uz: z.string().max(2000), ru: z.string().max(2000), en: z.string().max(2000) }).strict()
const id = z.string().min(1).max(80)
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const status = z.enum(['draft', 'published', 'archived'])
const visibility = z.enum(['public', 'private'])

export const PublishableInput = z.object({
  status: status.optional(),
  visibility: visibility.optional(),
  audience: z.object({ studentIds: z.array(id).max(500), groupIds: z.array(id).max(100) }).strict().optional(),
  featured: z.boolean().optional(),
  reviewRequested: z.boolean().optional(),
}).strict()
export type PublishableInput = z.infer<typeof PublishableInput>

const GroupBase = z.object({
  name: z.string().min(1).max(80),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  start: hhmm,
  end: hhmm,
  room: z.string().max(40).default(''),
  capacity: z.number().int().min(1).max(500),
}).strict()
export const GroupInput = GroupBase.refine((g) => g.start < g.end, { message: 'start must be before end', path: ['end'] })
export const GroupPatch = GroupBase.partial().refine((g) => !g.start || !g.end || g.start < g.end, { message: 'start must be before end', path: ['end'] })
export type GroupInput = z.infer<typeof GroupInput>

/** A course discount window (instants as UTC ISO strings). The percent limit is technical, not a company rule yet. */
export const DiscountInput = z
  .object({ percent: z.number().int().min(1).max(MAX_DISCOUNT_PERCENT), startsAt: z.string().datetime(), endsAt: z.string().datetime() })
  .strict()
  .refine((d) => checkDiscount(d).ok, { message: 'The discount must end after it starts' })

/** Body of PUT manage/courses/:id/discount: the new window, or null to remove the discount. */
export const CourseDiscountBody = z.object({ discount: DiscountInput.nullable() }).strict()

/** Learning format of a course; the service applies the rules for each (see ManageService.createCourse). */
export const LearningFormatInput = z.enum(['OFFLINE', 'ONLINE'])
export const CertificateInput = z.enum(['NONE', 'FREE', 'PAID', 'AVAILABLE'])

export const CourseInput = z.object({
  title: L,
  categoryId: id,
  /** OFFLINE courses need a center and a teacher; ONLINE courses belong to the platform center and ignore them. */
  centerId: id.optional(),
  teacherId: id.optional(),
  subjectId: id.nullable().optional(),
  learningFormat: LearningFormatInput.optional(),
  /** ONLINE only: the course page on the provider's site (plain https). */
  externalUrl: z.string().max(500).refine(isSafeExternalUrl, 'externalUrl must be a plain https link').nullable().optional(),
  providerName: z.string().trim().min(1).max(120).nullable().optional(),
  instructorName: z.string().trim().max(160).nullable().optional(),
  certificate: CertificateInput.optional(),
  durationText: L.nullable().optional(),
  summary: L,
  description: L,
  curriculum: z.array(L).max(40),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  durationMonths: z.number().int().min(1).max(36),
  /** Monthly price in so'm (converted to tiyin server-side). */
  price: z.number().int().min(0).max(100_000_000),
  coverSeed: z.number().int().min(0).max(10_000).optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  meyosGrant: z.boolean().optional(),
  /** A discount window; null removes it, leaving it out keeps the current one. Only the Super Admin or the course's center may set it. */
  discount: DiscountInput.nullable().optional(),
}).strict().merge(PublishableInput)
export const CoursePatch = CourseInput.partial()

export const VideoInput = z.object({
  teacherId: id.optional(),
  courseId: id.nullable().optional(),
  title: L,
  description: L,
  source: z.union([z.object({ kind: z.literal('link'), url: z.string().url().max(500) }).strict(), z.object({ kind: z.literal('upload'), key: z.string().max(300), url: z.string().max(500).optional() }).strict()]),
  durationSec: z.number().int().min(0).max(86_400).default(0),
  thumbnailUrl: z.string().max(500).nullable().optional(),
  coverSeed: z.number().int().min(0).max(10_000).optional(),
}).strict().merge(PublishableInput)
export const VideoPatch = VideoInput.partial()

export const PlaylistInput = z.object({
  teacherId: id.optional(),
  title: L,
  description: L,
  videoIds: z.array(id).max(200),
  coverSeed: z.number().int().min(0).max(10_000).optional(),
}).strict().merge(PublishableInput)
export const PlaylistPatch = PlaylistInput.partial()

export const ResourceInput = z.object({
  teacherId: id.optional(),
  courseId: id.nullable().optional(),
  title: L,
  description: L,
  kind: z.enum(['pdf', 'doc', 'sheet', 'link', 'other']),
  file: z.object({ name: z.string().max(200), size: z.number().int().min(0), mime: z.string().max(100), key: z.string().max(300).optional() }).strict().nullable().optional(),
  url: z.string().max(500).nullable().optional(),
  pages: z.number().int().min(0).max(10_000).nullable().optional(),
}).strict().merge(PublishableInput)
export const ResourcePatch = ResourceInput.partial()

export const SubjectInput = z.object({ teacherId: id.optional(), name: L, description: L }).strict()
export const CenterInput = z.object({ name: z.string().min(1).max(120), district: L, description: L, tone: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), address: z.string().max(300).nullable().optional() }).strict()
/** Super Admin: approval state of a center. */
export const CenterStatusInput = z.object({ status: z.enum(['PENDING', 'ACTIVE', 'BLOCKED', 'REJECTED']), reason: z.string().trim().max(300).optional() }).strict()
export type CenterStatusInput = z.infer<typeof CenterStatusInput>
export const DeleteUserInput = z.object({ reason: z.string().trim().min(3).max(300) }).strict()
/** Center workspace: the center's own profile and check-in settings (all optional; only sent fields change). */
export const CenterProfileInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  district: L.optional(),
  description: L.optional(),
  tone: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  address: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().min(7).max(20).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  /** Metres; null switches the location check off. */
  geoRadiusM: z.number().int().min(20).max(5000).nullable().optional(),
  checkInBeforeMin: z.number().int().min(0).max(180).optional(),
  absenceAfterMin: z.number().int().min(0).max(240).optional(),
}).strict()
export type CenterProfileInput = z.infer<typeof CenterProfileInput>
/** Center workspace: a teacher of the center; `login` links the registered account of that teacher. */
export const CenterTeacherInput = z.object({
  name: z.string().trim().min(1).max(120),
  title: L.optional(),
  bio: L.optional(),
  tagline: L.optional(),
  expertise: z.array(z.string().max(60)).max(20).optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  login: z.string().trim().min(3).max(32).optional(),
}).strict()
export const CenterTeacherPatch = CenterTeacherInput.omit({ login: true }).partial()
export type CenterTeacherInput = z.infer<typeof CenterTeacherInput>
export type CenterTeacherPatch = z.infer<typeof CenterTeacherPatch>
export const CategoryInput = z.object({ name: L, glyph: z.string().max(8).optional(), sortOrder: z.number().int().optional() }).strict()
export const SafeMediaUrl = z.string().max(500).refine((val) => {
  if (!val) return true
  return /^(https?:\/\/|\/|avatars\/|banners\/)/i.test(val)
}, { message: 'Must be a valid HTTP/HTTPS URL, relative path, or storage key' })

export const TeacherInput = z.object({
  name: z.string().min(1).max(120),
  title: L,
  bio: L,
  expertise: z.array(z.string().max(60)).max(20),
  centerId: id,
  avatarSeed: z.number().int().optional(),
  bannerTone: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatarUrl: SafeMediaUrl.nullable().optional(),
  bannerUrl: SafeMediaUrl.nullable().optional(),
  tagline: L,
  channelActive: z.boolean().optional(),
  featured: z.object({ type: z.enum(['course', 'playlist']), id }).strict().nullable().optional(),
  /** Phone of the login account to link (creates the user if missing). */
  phone: z.string().min(7).max(20).optional(),
}).strict()
export const TeacherPatch = TeacherInput.partial()
export const AvatarUploadUrlInput = z.object({
  fileName: z.string().min(1).max(120).regex(/^[^\\/:*?"<>|]+$/, 'Invalid file name').refine((name) => !Array.from(name).some((c) => c.charCodeAt(0) < 32), { message: 'Control characters not allowed in file name' }),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  fileSize: z.number().int().min(1).max(2 * 1024 * 1024), // max 2MB
}).strict()
export const PackageInput = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,30}$/), name: L, description: L, perks: z.array(L).max(12), maxCourses: z.number().int().min(1).max(6), enabled: z.boolean(), highlight: z.boolean(), sortOrder: z.number().int().optional(),
  /** PERIOD: periodDays per payment (null = one calendar month); LESSONS: lessonCount attended lessons per payment. */
  accessKind: z.enum(['PERIOD', 'LESSONS']).optional(),
  periodDays: z.number().int().min(1).max(366).nullable().optional(),
  lessonCount: z.number().int().min(1).max(500).nullable().optional(),
}).strict().refine((p) => p.accessKind !== 'LESSONS' || (p.lessonCount ?? 0) > 0, { message: 'A lesson-based package needs a lesson count', path: ['lessonCount'] })
export const PackagePatch = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,30}$/).optional(), name: L.optional(), description: L.optional(), perks: z.array(L).max(12).optional(), maxCourses: z.number().int().min(1).max(6).optional(), enabled: z.boolean().optional(), highlight: z.boolean().optional(), sortOrder: z.number().int().optional(),
  accessKind: z.enum(['PERIOD', 'LESSONS']).optional(),
  periodDays: z.number().int().min(1).max(366).nullable().optional(),
  lessonCount: z.number().int().min(1).max(500).nullable().optional(),
}).strict()
export const UserRolesInput = z.object({
  /** PLATFORM_ADMIN (Super Admin) sets the owner flag; the route is open only to existing owners. */
  roles: z.array(z.enum(['PLATFORM_ADMIN', 'FINANCE_ADMIN', 'CENTER_ADMIN', 'TEACHER', 'STUDENT'])).min(1),
  centerId: id.nullable().optional(),
  isActive: z.boolean().optional(),
  reason: z.string().min(3).max(300),
}).strict()
export const StudentAdminInput = z.object({ displayName: z.string().min(2).max(60).optional(), district: z.string().max(60).nullable().optional(), preferredLang: z.enum(['uz', 'ru', 'en']).optional() }).strict()
