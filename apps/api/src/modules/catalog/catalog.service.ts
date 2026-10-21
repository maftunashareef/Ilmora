import { Injectable } from '@nestjs/common'
import { AppError } from '../../common/errors'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'

/**
 * Read models for the public site and the dashboards. Shapes match the web app's domain types
 * (see @ilmora/shared) so the migrated UI can consume them with minimal translation.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything a public page needs in one round trip; private/draft content is excluded. */
  async publicCatalog(tenantId: string) {
    const [centers, categories, teachers, subjects, courses, seats] = await Promise.all([
      this.prisma.client.center.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
      this.prisma.client.category.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.client.teacherProfile.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
      this.prisma.client.subject.findMany({ where: { tenantId } }),
      this.prisma.client.course.findMany({ where: { tenantId, status: 'PUBLISHED', visibility: 'PUBLIC' }, include: { groups: { where: { deletedAt: null } } }, orderBy: { createdAt: 'asc' } }),
      this.seatCounts(tenantId),
    ])
    return {
      centers: centers.map(toCenter),
      categories: categories.map(toCategory),
      teachers: teachers.map(toTeacher),
      subjects: subjects.map((s) => ({ id: s.id, teacherId: s.teacherId, name: s.name, description: s.description })),
      courses: courses.map((c) => toCourse(c, seats)),
    }
  }

  async seatCounts(tenantId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.client.enrollment.groupBy({ by: ['groupId'], where: { tenantId, status: 'ACTIVE' }, _count: { _all: true } })
    return new Map(rows.map((r) => [r.groupId, r._count._all]))
  }

  async courseBySlugOrId(tenantId: string, key: string, actor?: RequestActor) {
    const course = await this.prisma.client.course.findFirst({ where: { tenantId, OR: [{ slug: key }, { id: key }] }, include: { groups: { where: { deletedAt: null } } } })
    if (!course) throw AppError.notFound('Course')
    if (!canView(course, actor, await this.actorGroupIds(actor))) throw AppError.forbidden('This course is not available', { reason: course.status !== 'PUBLISHED' ? course.status.toLowerCase() : 'private' })
    const seats = await this.seatCounts(tenantId)
    return toCourse(course, seats)
  }

  async teacherContent(tenantId: string, teacherKey: string, actor?: RequestActor) {
    const teacher = await this.prisma.client.teacherProfile.findFirst({ where: { tenantId, OR: [{ slug: teacherKey }, { id: teacherKey }] } })
    if (!teacher) throw AppError.notFound('Teacher')
    const groupIds = await this.actorGroupIds(actor)
    const [videos, playlists, resources, courses, seats] = await Promise.all([
      this.prisma.client.video.findMany({ where: { tenantId, teacherId: teacher.id }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.playlist.findMany({ where: { tenantId, teacherId: teacher.id }, include: { items: { orderBy: { position: 'asc' } } } }),
      this.prisma.client.resource.findMany({ where: { tenantId, teacherId: teacher.id }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.course.findMany({ where: { tenantId, teacherId: teacher.id }, include: { groups: { where: { deletedAt: null } } } }),
      this.seatCounts(tenantId),
    ])
    return {
      teacher: toTeacher(teacher),
      courses: courses.filter((c) => canView(c, actor, groupIds)).map((c) => toCourse(c, seats)),
      videos: videos.filter((v) => canView(v, actor, groupIds)).map(toVideo),
      playlists: playlists.filter((p) => canView(p, actor, groupIds)).map(toPlaylist),
      resources: resources.filter((r) => canView(r, actor, groupIds)).map(toResource),
    }
  }

  async contentItem(tenantId: string, kind: 'video' | 'playlist' | 'resource', id: string, actor?: RequestActor) {
    const groupIds = await this.actorGroupIds(actor)
    if (kind === 'video') {
      const v = await this.prisma.client.video.findFirst({ where: { tenantId, id } })
      if (!v) throw AppError.notFound('Video')
      if (!canView(v, actor, groupIds)) throw AppError.forbidden('Not available', { reason: denyReason(v) })
      return toVideo(v)
    }
    if (kind === 'playlist') {
      const p = await this.prisma.client.playlist.findFirst({ where: { tenantId, id }, include: { items: { orderBy: { position: 'asc' } } } })
      if (!p) throw AppError.notFound('Playlist')
      if (!canView(p, actor, groupIds)) throw AppError.forbidden('Not available', { reason: denyReason(p) })
      return toPlaylist(p)
    }
    const r = await this.prisma.client.resource.findFirst({ where: { tenantId, id } })
    if (!r) throw AppError.notFound('Resource')
    if (!canView(r, actor, groupIds)) throw AppError.forbidden('Not available', { reason: denyReason(r) })
    return toResource(r)
  }

  /** Group ids of the actor's ACTIVE enrollments (drives private-content access). */
  async actorGroupIds(actor?: RequestActor): Promise<string[]> {
    if (!actor) return []
    const rows = await this.prisma.client.enrollment.findMany({ where: { studentId: actor.id, status: 'ACTIVE' }, select: { groupId: true } })
    return rows.map((r) => r.groupId)
  }
}

// ───────── access rule (server-side twin of @ilmora/shared checkAccess) ─────────

interface Publishable { status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; visibility: 'PUBLIC' | 'PRIVATE'; audienceStudentIds: string[]; audienceGroupIds: string[]; teacherId: string }

export function canView(item: Publishable, actor: RequestActor | undefined, actorGroupIds: string[]): boolean {
  if (actor?.roles.includes('PLATFORM_ADMIN')) return true
  if (actor?.teacherProfileId && actor.teacherProfileId === item.teacherId) return true
  if (item.status !== 'PUBLISHED') return false
  if (item.visibility === 'PUBLIC') return true
  if (!actor) return false
  if (item.audienceStudentIds.includes(actor.id)) return true
  return actorGroupIds.some((g) => item.audienceGroupIds.includes(g))
}

const denyReason = (item: Publishable) => (item.status === 'DRAFT' ? 'draft' : item.status === 'ARCHIVED' ? 'archived' : 'private')

// ───────── mappers to the web domain shapes ─────────

const lower = <T extends string>(v: T) => v.toLowerCase()

export const toCenter = (c: { id: string; slug: string; name: string; district: unknown; description: unknown; tone: string }) => ({ id: c.id, slug: c.slug, name: c.name, district: c.district, description: c.description, tone: c.tone })
export const toCategory = (c: { id: string; slug: string; name: unknown; glyph: string }) => ({ id: c.id, slug: c.slug, name: c.name, glyph: c.glyph })
export const toTeacher = (t: { id: string; slug: string; name: string; title: unknown; bio: unknown; expertise: string[]; centerId: string | null; avatarSeed: number; bannerTone: string; avatarUrl: string | null; bannerUrl: string | null; tagline: unknown; channelActive: boolean; featuredType: string | null; featuredId: string | null }) => ({
  id: t.id, slug: t.slug, name: t.name, title: t.title, bio: t.bio, expertise: t.expertise, centerId: t.centerId, avatarSeed: t.avatarSeed, bannerTone: t.bannerTone,
  avatarUrl: t.avatarUrl ?? undefined, bannerUrl: t.bannerUrl ?? undefined, tagline: t.tagline, channelActive: t.channelActive,
  featured: t.featuredType && t.featuredId ? { type: t.featuredType, id: t.featuredId } : undefined,
})
export const toGroup = (g: { id: string; courseId: string; name: string; days: number[]; startTime: string; endTime: string; room: string; capacity: number }, seats?: Map<string, number>) => ({
  id: g.id, courseId: g.courseId, name: g.name, days: g.days, start: g.startTime, end: g.endTime, room: g.room, capacity: g.capacity, enrolled: seats?.get(g.id) ?? 0,
})
export const toCourse = (c: {
  id: string; slug: string; title: unknown; categoryId: string; centerId: string; teacherId: string; subjectId: string | null; summary: unknown; description: unknown; curriculum: unknown;
  level: string; durationMonths: number; priceMinor: bigint; currency: string; coverSeed: number; imageUrl: string | null; meyosGrant: boolean; status: string; visibility: string;
  audienceStudentIds: string[]; audienceGroupIds: string[]; featured: boolean; reviewRequested: boolean; updatedAt: Date;
  groups: { id: string; courseId: string; name: string; days: number[]; startTime: string; endTime: string; room: string; capacity: number }[]
}, seats?: Map<string, number>) => ({
  id: c.id, slug: c.slug, title: c.title, categoryId: c.categoryId, centerId: c.centerId, teacherId: c.teacherId, subjectId: c.subjectId ?? undefined,
  summary: c.summary, description: c.description, curriculum: c.curriculum, level: lower(c.level), durationMonths: c.durationMonths,
  price: Number(c.priceMinor / 100n), priceMinor: c.priceMinor.toString(), currency: c.currency, coverSeed: c.coverSeed, imageUrl: c.imageUrl ?? undefined, meyosGrant: c.meyosGrant,
  status: lower(c.status), visibility: lower(c.visibility), audience: { studentIds: c.audienceStudentIds, groupIds: c.audienceGroupIds }, featured: c.featured, reviewRequested: c.reviewRequested,
  updatedAt: c.updatedAt.toISOString(), groups: c.groups.map((g) => toGroup(g, seats)),
})
export const toVideo = (v: { id: string; teacherId: string; courseId: string | null; title: unknown; description: unknown; sourceKind: string; sourceUrl: string | null; storageKey: string | null; durationSec: number; thumbnailUrl: string | null; coverSeed: number; status: string; visibility: string; audienceStudentIds: string[]; audienceGroupIds: string[]; featured: boolean; reviewRequested: boolean; updatedAt: Date }) => ({
  id: v.id, teacherId: v.teacherId, courseId: v.courseId ?? undefined, title: v.title, description: v.description,
  source: v.sourceKind === 'UPLOAD' ? { kind: 'upload', key: v.storageKey, url: v.sourceUrl } : { kind: 'link', url: v.sourceUrl ?? '' },
  durationSec: v.durationSec, thumbnailUrl: v.thumbnailUrl ?? undefined, coverSeed: v.coverSeed, status: lower(v.status), visibility: lower(v.visibility),
  audience: { studentIds: v.audienceStudentIds, groupIds: v.audienceGroupIds }, featured: v.featured, reviewRequested: v.reviewRequested, updatedAt: v.updatedAt.toISOString(),
})
export const toPlaylist = (p: { id: string; teacherId: string; title: unknown; description: unknown; coverSeed: number; status: string; visibility: string; audienceStudentIds: string[]; audienceGroupIds: string[]; featured: boolean; reviewRequested: boolean; updatedAt: Date; items: { videoId: string }[] }) => ({
  id: p.id, teacherId: p.teacherId, title: p.title, description: p.description, videoIds: p.items.map((i) => i.videoId), coverSeed: p.coverSeed,
  status: lower(p.status), visibility: lower(p.visibility), audience: { studentIds: p.audienceStudentIds, groupIds: p.audienceGroupIds }, featured: p.featured, reviewRequested: p.reviewRequested, updatedAt: p.updatedAt.toISOString(),
})
export const toResource = (r: { id: string; teacherId: string; courseId: string | null; title: unknown; description: unknown; kind: string; fileName: string | null; fileSize: number | null; fileMime: string | null; url: string | null; pages: number | null; status: string; visibility: string; audienceStudentIds: string[]; audienceGroupIds: string[]; featured: boolean; reviewRequested: boolean; updatedAt: Date }) => ({
  id: r.id, teacherId: r.teacherId, courseId: r.courseId ?? undefined, title: r.title, description: r.description, kind: lower(r.kind),
  file: r.fileName ? { name: r.fileName, size: r.fileSize ?? 0, mime: r.fileMime ?? 'application/octet-stream' } : undefined, url: r.url ?? undefined, pages: r.pages ?? undefined,
  status: lower(r.status), visibility: lower(r.visibility), audience: { studentIds: r.audienceStudentIds, groupIds: r.audienceGroupIds }, featured: r.featured, reviewRequested: r.reviewRequested, updatedAt: r.updatedAt.toISOString(),
})
