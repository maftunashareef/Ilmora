import { Injectable } from '@nestjs/common'
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

  async get(tenantId: string): Promise<SiteConfigData & { version: number; packages: PackageDto[] }> {
    const [row, packages] = await Promise.all([
      this.prisma.client.siteConfig.findUnique({ where: { tenantId } }),
      this.prisma.client.package.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } }),
    ])
    if (!row) throw AppError.notFound('Site configuration')
    return { ...(row.data as SiteConfigData), version: row.version, packages: packages.map(toPackageDto) }
  }

  async update(tenantId: string, input: unknown, expectedVersion?: number): Promise<{ version: number }> {
    const parsed = SiteConfigSchema.safeParse(input)
    if (!parsed.success) throw AppError.invalid('invalid_site_config', 'Site configuration is invalid', { issues: parsed.error.issues.slice(0, 20) })
    const current = await this.prisma.client.siteConfig.findUnique({ where: { tenantId } })
    if (!current) throw AppError.notFound('Site configuration')
    if (expectedVersion !== undefined && expectedVersion !== current.version) throw AppError.conflict('version_conflict', 'The site configuration was changed by someone else; reload and retry')
    const updated = await this.prisma.tx(async (tx) => {
      const u = await tx.siteConfig.update({ where: { tenantId }, data: { data: parsed.data as unknown as Prisma.InputJsonValue, version: { increment: 1 } } })
      await this.audit.record({ tx, action: 'site.update', entityType: 'SiteConfig', entityId: tenantId, before: { version: current.version }, after: { version: u.version } })
      return u
    })
    return { version: updated.version }
  }
}

export interface PackageDto { id: string; code: string; name: unknown; description: unknown; perks: unknown; maxCourses: number; enabled: boolean; highlight: boolean }
export const toPackageDto = (p: { id: string; code: string; name: unknown; description: unknown; perks: unknown; maxCourses: number; enabled: boolean; highlight: boolean }): PackageDto => ({
  id: p.id, code: p.code, name: p.name, description: p.description, perks: p.perks, maxCourses: p.maxCourses, enabled: p.enabled, highlight: p.highlight,
})
