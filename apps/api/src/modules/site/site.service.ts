import { Injectable } from '@nestjs/common'
import { isSafeExternalUrl, presetPublishability, universityDirections, unknownDirections, type Preset, type PresetCourse, type University } from '@ilmora/shared'
import { z } from 'zod'
import { AppError } from '../../common/errors'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { AuditService } from '../audit/audit.service'

const L = z.object({ uz: z.string(), ru: z.string(), en: z.string() })
const Section = z.object({
  id: z.string().min(1).max(60),
  type: z.string().min(1).max(40),
  enabled: z.boolean(),
  title: L,
  subtitle: L,
  body: L.optional(),
  imageUrl: z.string().max(500).optional(),
  count: z.number().int().min(0).max(50).optional(),
  items: z.array(z.object({ id: z.string(), title: L, body: L })).max(20).optional(),
})

/** Where a package's required subjects come from. An official https page is required before a package can be published (see presetPublishability). */
const AdmissionSchema = z.object({
  url: z.string().max(500).refine((v) => v === '' || isSafeExternalUrl(v), 'url must be a plain https link'),
  academicYear: z.string().trim().max(20),
  checkedOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'checkedOn must be YYYY-MM-DD'),
  status: z.enum(['verified', 'needs_review']),
  note: z.string().max(600),
})

const httpsOrEmpty = (what: string) => z.string().max(500).refine((v) => v === '' || isSafeExternalUrl(v), `${what} must be a plain https link`)

/** A study direction with the entrance subjects the university states for it. */
const DirectionSchema = z.object({ id: z.string().min(1).max(60), name: L, subjects: z.array(L).max(8) })
const FacultySchema = z.object({ id: z.string().min(1).max(60), name: L, directions: z.array(DirectionSchema).max(30) })

/** A university that packages refer to. ILMORA is not affiliated with it; the record is plain data. */
const UniversitySchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().max(30).optional(),
  city: z.string().trim().max(60).optional(),
  country: z.string().trim().max(60).optional(),
  website: httpsOrEmpty('website').optional(),
  // An uploaded logo (https, object storage) or an official logo file shipped with the site under /universities/.
  logoUrl: z.string().max(500).refine((v) => v === '' || isSafeExternalUrl(v) || /^\/universities\/[a-z0-9-]+\.(svg|png|webp)$/.test(v), 'logoUrl must be a plain https link or a /universities/ file').optional(),
  logoOnDark: z.boolean().optional(),
  faculties: z.array(FacultySchema).max(20).optional(),
})

/** Ready-made course set; `courseId` must point at an existing course (checked in SiteService.assertPresetsUsable). */
const PresetSchema = z.object({
  id: z.string().min(1).max(60),
  universityId: z.string().min(1).max(60).optional(),
  university: z.string().trim().max(80).optional(),
  program: L.optional(),
  directionIds: z.array(z.string().min(1).max(60)).max(30).optional(),
  name: L,
  description: L,
  slots: z.array(z.object({ id: z.string().min(1).max(60), label: L, courseId: z.string().min(1).max(80).nullable(), optional: z.boolean().optional() })).min(1).max(8),
  durationMonths: z.number().int().min(1).max(36).optional(),
  admission: AdmissionSchema.optional(),
  enabled: z.boolean(),
})

/** Validated shape of the Super Admin site template (mirrors SiteConfig in @ilmora/shared). */
export const SiteConfigSchema = z.object({
  brand: z.object({ name: z.string().min(1).max(40), heroHeadline: L, heroTagline: L, primaryCta: L, footerNote: L, city: L }),
  theme: z.object({
    colors: z.object({ ivory: z.string(), forest: z.string(), charcoal: z.string(), champagne: z.string(), sage: z.string(), white: z.string() }),
    fonts: z.object({ display: z.enum(['Cormorant Garamond', 'Playfair Display']), body: z.enum(['Inter', 'Manrope']) }),
    radius: z.enum(['sharp', 'soft', 'round']),
  }),
  nav: z.array(z.object({ id: z.string(), label: L, path: z.string().max(100), enabled: z.boolean() })).max(12),
  pages: z.object({ home: z.array(Section).max(30), howItWorks: z.array(Section).max(30), centers: z.array(Section).max(30) }),
  faq: z.array(z.object({ id: z.string(), q: L, a: L })).max(50),
  features: z.record(z.string(), z.boolean()),
  permissions: z.object({ teacher: z.record(z.string(), z.boolean()), student: z.record(z.string(), z.boolean()) }),
  // Optional on purpose: a save that leaves it out keeps the stored presets (see SiteService.update).
  presets: z.array(PresetSchema).max(150).optional(),
  // Optional for the same reason: a save that leaves it out keeps the stored universities.
  universities: z.array(UniversitySchema).max(100).optional(),
  announcements: z.array(z.object({ id: z.string(), title: L, body: L, audience: z.enum(['all', 'students', 'teachers']), enabled: z.boolean() })).max(50),
  media: z.object({ heroVideoUrl: z.string().max(500), heroPosterUrl: z.string().max(500), furnitureVideoUrl: z.string().max(500), furniturePosterUrl: z.string().max(500) }),
  courseCard: z.object({ showCenter: z.boolean(), showTeacher: z.boolean(), showLevel: z.boolean(), showSchedule: z.boolean(), showCategory: z.boolean(), priceStyle: z.enum(['plain', 'emphasis']) }),
  payments: z.object({ methods: z.array(z.object({ id: z.enum(['card', 'payme', 'click', 'cash']), enabled: z.boolean() })) }),
  dashboards: z.object({ student: z.array(z.object({ id: z.string(), enabled: z.boolean() })), teacher: z.array(z.object({ id: z.string(), enabled: z.boolean() })) }),
})
export type SiteConfigData = z.infer<typeof SiteConfigSchema>

@Injectable()
export class SiteService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * The public site configuration. Presets that are not enabled are internal (their names, such as university
   * names, may not be approved for public use yet), so only the Super Admin read (`includeDisabledPresets`) sees them.
   */
  async get(tenantId: string, includeDisabledPresets = false): Promise<SiteConfigData & { version: number; packages: PackageDto[] }> {
    const [row, packages] = await Promise.all([
      this.prisma.client.siteConfig.findUnique({ where: { tenantId } }),
      this.prisma.client.package.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } }),
    ])
    if (!row) throw AppError.notFound('Site configuration')
    const data = row.data as SiteConfigData
    const presets = (data.presets ?? []).filter((p) => includeDisabledPresets || p.enabled)
    // The public site lists only universities that have a published package; the Super Admin sees them all.
    const used = new Set(presets.map((p) => p.universityId))
    const universities = (data.universities ?? []).filter((u) => includeDisabledPresets || used.has(u.id))
    return { ...data, presets, universities, version: row.version, packages: packages.map(toPackageDto) }
  }

  async update(tenantId: string, input: unknown, expectedVersion?: number): Promise<{ version: number }> {
    const parsed = SiteConfigSchema.safeParse(input)
    if (!parsed.success) throw AppError.invalid('invalid_site_config', 'Site configuration is invalid', { issues: parsed.error.issues.slice(0, 20) })
    const current = await this.prisma.client.siteConfig.findUnique({ where: { tenantId } })
    if (!current) throw AppError.notFound('Site configuration')
    if (expectedVersion !== undefined && expectedVersion !== current.version) throw AppError.conflict('version_conflict', 'The site configuration was changed by someone else; reload and retry')
    // A save without `presets` (a client that has not loaded the full list) must never wipe the stored ones.
    const stored = (current.data as { presets?: unknown } | null)?.presets
    const storedUniversities = (current.data as { universities?: unknown } | null)?.universities
    const presets = parsed.data.presets
    const universities = parsed.data.universities ?? (Array.isArray(storedUniversities) ? (storedUniversities as University[]) : [])
    if (new Set(universities.map((u) => u.id)).size !== universities.length) throw AppError.invalid('duplicate_university', 'Two universities share the same id')
    const directionIds = universities.flatMap((u) => universityDirections(u).map((d) => d.direction.id))
    if (new Set(directionIds).size !== directionIds.length) throw AppError.invalid('duplicate_direction', 'Two directions share the same id')
    if (presets) {
      const unknown = presets.find((p) => p.universityId && !universities.some((u) => u.id === p.universityId))
      if (unknown) throw AppError.invalid('unknown_university', 'A package refers to a university that does not exist', { presetId: unknown.id })
      const strayDirection = presets.find((p) => unknownDirections(p, universities).length > 0)
      if (strayDirection) throw AppError.invalid('unknown_direction', 'A package refers to a direction its university does not have', { presetId: strayDirection.id })
      await this.assertPresetsUsable(presets, stored)
    }
    const data = { ...parsed.data, presets: presets ?? (Array.isArray(stored) ? (stored as Preset[]) : []), universities }
    const updated = await this.prisma.tx(async (tx) => {
      const u = await tx.siteConfig.update({ where: { tenantId }, data: { data: data as unknown as Prisma.InputJsonValue, version: { increment: 1 } } })
      await this.audit.record({ tx, action: 'site.update', entityType: 'SiteConfig', entityId: tenantId, before: { version: current.version }, after: { version: u.version } })
      return u
    })
    return { version: updated.version }
  }

  /**
   * Presets may only reference existing courses. A package may only be switched on (or have its courses or its admission
   * source changed while on) when every subject maps to an available course and, for a university package, its
   * requirements are verified against an official page (presetPublishability). A published package cannot be deleted:
   * unpublish it first. Presets that did not change are not re-checked, so a course that later becomes unavailable never
   * blocks unrelated site edits; the public page then shows that preset as unavailable.
   */
  async assertPresetsUsable(presets: Preset[], previous: unknown): Promise<void> {
    type Stored = { id?: unknown; enabled?: unknown; slots?: unknown; admission?: { status?: unknown; url?: unknown; academicYear?: unknown; checkedOn?: unknown } }
    const signature = (p: Stored) =>
      [
        p.enabled ? 1 : 0,
        (Array.isArray(p.slots) ? p.slots : []).map((s: { courseId?: string | null }) => s?.courseId ?? '').join(','),
        p.admission?.status ?? '', p.admission?.url ?? '', p.admission?.academicYear ?? '', p.admission?.checkedOn ?? '',
      ].join('|')
    const before = new Map<unknown, string>()
    const previousList = Array.isArray(previous) ? (previous as Stored[]) : []
    for (const p of previousList) before.set(p?.id, signature(p ?? {}))
    const kept = new Set(presets.map((p) => p.id))
    const removed = previousList.find((p) => p?.enabled && !kept.has(p.id as string))
    if (removed) throw AppError.invalid('published_preset_removed', 'A published package cannot be deleted: unpublish it first', { presetId: removed.id })
    const changed = presets.filter((p) => before.get(p.id) !== signature(p))
    const ids = [...new Set(changed.flatMap((p) => p.slots.map((s) => s.courseId)).filter((id): id is string => !!id))]
    if (changed.length === 0) return
    const rows = ids.length
      ? await this.prisma.client.course.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, status: true, visibility: true, groups: { where: { deletedAt: null }, select: { id: true } } } })
      : []
    const courses: PresetCourse[] = rows.map((c) => ({ id: c.id, status: c.status.toLowerCase() as PresetCourse['status'], visibility: c.visibility.toLowerCase() as PresetCourse['visibility'], groups: c.groups }))
    const known = new Set(courses.map((c) => c.id))
    for (const preset of changed) {
      const unknown = preset.slots.find((s) => s.courseId && !known.has(s.courseId))
      if (unknown) throw AppError.invalid('invalid_preset_course', 'A preset refers to a course that does not exist', { presetId: preset.id, slotId: unknown.id })
      if (!preset.enabled) continue
      const { ok, ready, issues, admission } = presetPublishability(preset, courses)
      if (ok) continue
      if (!ready) throw AppError.invalid('preset_not_ready', 'Every subject of a package must map to an available course before it can be published', { presetId: preset.id, issues })
      throw AppError.invalid('preset_not_verified', 'A university package can only be published once its admission requirements are verified against an official page', { presetId: preset.id, admission })
    }
  }
}

export interface PackageDto { id: string; code: string; name: unknown; description: unknown; perks: unknown; maxCourses: number; enabled: boolean; highlight: boolean }
export const toPackageDto = (p: { id: string; code: string; name: unknown; description: unknown; perks: unknown; maxCourses: number; enabled: boolean; highlight: boolean }): PackageDto => ({
  id: p.id, code: p.code, name: p.name, description: p.description, perks: p.perks, maxCourses: p.maxCourses, enabled: p.enabled, highlight: p.highlight,
})
