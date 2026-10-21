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

export const CourseInput = z.object({
  title: L,
  categoryId: id,
  centerId: id,
  teacherId: id,
  subjectId: id.nullable().optional(),
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
export const CategoryInput = z.object({ name: L, glyph: z.string().max(8).optional(), sortOrder: z.number().int().optional() }).strict()
export const TeacherInput = z.object({
  name: z.string().min(1).max(120),
  title: L,
  bio: L,
  expertise: z.array(z.string().max(60)).max(20),
  centerId: id,
  avatarSeed: z.number().int().optional(),
  bannerTone: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  bannerUrl: z.string().max(500).nullable().optional(),
  tagline: L,
  channelActive: z.boolean().optional(),
  featured: z.object({ type: z.enum(['course', 'playlist']), id }).strict().nullable().optional(),
  /** Phone of the login account to link (creates the user if missing). */
  phone: z.string().min(7).max(20).optional(),
}).strict()
export const TeacherPatch = TeacherInput.partial()
export const PackageInput = z.object({ code: z.string().regex(/^[a-z0-9-]{2,30}$/), name: L, description: L, perks: z.array(L).max(12), maxCourses: z.number().int().min(1).max(6), enabled: z.boolean(), highlight: z.boolean(), sortOrder: z.number().int().optional() }).strict()
export const PackagePatch = PackageInput.partial()
export const UserRolesInput = z.object({
  /** PLATFORM_ADMIN (Super Admin) is deliberately absent: it exists only for the configured owner account. */
  roles: z.array(z.enum(['FINANCE_ADMIN', 'CENTER_ADMIN', 'TEACHER', 'STUDENT'])).min(1),
  centerId: id.nullable().optional(),
  isActive: z.boolean().optional(),
  reason: z.string().min(3).max(300),
}).strict()
export const StudentAdminInput = z.object({ displayName: z.string().min(2).max(60).optional(), district: z.string().max(60).nullable().optional(), preferredLang: z.enum(['uz', 'ru', 'en']).optional() }).strict()
