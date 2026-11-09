import type { DirectionDto, IndustryDto, L } from '@ilmora/shared'

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
