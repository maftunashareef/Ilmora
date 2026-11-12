import type { DirectionDto, IndustryDto, L, PlaceRefDto } from '@ilmora/shared'
import type { PrismaService } from '../../infra/prisma/prisma.service'

/** Prisma selections and response mappers shared by the registry modules (reference data, institutions, companies). */

export const INDUSTRY_SELECT = { id: true, slug: true, name: true } as const
export const DIRECTION_SELECT = { id: true, name: true, origin: true, code: true, industry: { select: INDUSTRY_SELECT } } as const
/** A direction with its main direction when it is a merged alias (docs/registry/data-model.md, «Слияние дублей»). */
export const DIRECTION_WITH_MAIN = { ...DIRECTION_SELECT, mergedInto: { select: DIRECTION_SELECT } } as const

type IndustryRow = { id: string; slug: string; name: unknown }
export type DirectionRow = { id: string; name: string; origin: string; code: string | null; industry: IndustryRow }

export const toIndustry = (i: IndustryRow): IndustryDto => ({ id: i.id, slug: i.slug, name: i.name as L })
export const toDirection = (d: DirectionRow): DirectionDto => ({ id: d.id, name: d.name, industry: toIndustry(d.industry), official: d.origin === 'OFFICIAL', code: d.code })
/** The main direction of a row read with DIRECTION_WITH_MAIN: an alias answers the direction it was merged into. */
export const mainOf = (d: DirectionRow & { mergedInto: DirectionRow | null }): DirectionDto => toDirection(d.mergedInto ?? d)

export const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === 'P2002'

/** When anything was last written about a record in the audit log (its edits, directions, certificate), in ms; 0 if never. */
export async function lastEdit(prisma: PrismaService, entityType: 'Institution' | 'Company', entityId: string): Promise<number> {
  const row = await prisma.client.auditEvent.findFirst({ where: { entityType, entityId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
  return row?.createdAt.getTime() ?? 0
}

/** Region and district as an institution or company refers to them. */
export const PLACE_SELECT = {
  region: { select: { id: true, slug: true, name: true } },
  district: { select: { id: true, name: true } },
  districtName: true,
} as const
type PlaceRow = { region: { id: string; slug: string | null; name: unknown } | null; district: { id: string; name: unknown } | null; districtName: string | null }
export const toPlace = (r: PlaceRow) => ({
  region: r.region ? { id: r.region.id, slug: r.region.slug, name: r.region.name as L } : null,
  district: r.district ? ({ id: r.district.id, name: r.district.name as L } satisfies PlaceRefDto) : null,
  districtName: r.districtName,
})

/**
 * The region a request names: the web app sends the region's slug (UZ_REGIONS, e.g. «andijan»), other callers the
 * database id — both are accepted (docs/registry/data-model.md). Null when there is no such region.
 */
export async function regionIdByRef(prisma: PrismaService, ref: string): Promise<string | null> {
  const row = await prisma.client.region.findFirst({ where: { OR: [{ id: ref }, { slug: ref }] }, select: { id: true } })
  return row?.id ?? null
}

/**
 * «Changes to review» reach the Super Admins at most once an hour per organisation: every save of an approved profile
 * used to notify them, so a loop of saves flooded them (cybersecurity check 9.4, 11.11). The review queue itself shows
 * the latest changes; a submission (`*.submitted`) is still notified each time.
 */
export const changedKey = (kind: 'company' | 'inst', id: string, now: Date) => `${kind}-review:${id}:changed:${Math.floor(now.getTime() / 3_600_000)}`
