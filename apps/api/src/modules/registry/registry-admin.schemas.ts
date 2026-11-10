import { DIRECTION_NAME_MAX, hasMarkup } from '@ilmora/shared'
import { z } from 'zod'
import { id, typedName } from './registry.schemas'

const label = z.string().transform((s) => s.normalize('NFC').trim().replace(/\s+/g, ' ')).pipe(z.string().min(2).max(100).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' }))
const localized = z.object({ uz: label, ru: label, en: label }).strict()

/** A new industry (ТЗ 12: the list is still being agreed): a URL-safe slug and the name in three languages. */
export const IndustryInput = z.object({ slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(40), name: localized, sortOrder: z.number().int().min(0).max(10_000).optional() }).strict()
/** Rename, reorder, hide (hidden: not offered for new directions and companies; what uses it stays). */
export const IndustryPatch = z.object({ name: localized, sortOrder: z.number().int().min(0).max(10_000), isActive: z.boolean() }).partial().strict()

/** Rename, move to another industry, set the classifier code. */
export const DirectionPatch = z.object({ name: typedName(DIRECTION_NAME_MAX), industryId: id, code: z.string().trim().max(32).nullable() }).partial().strict()
export const MergeInput = z.object({ intoId: id }).strict()

export const AdminDirectionsQuery = z.object({
  q: z.string().max(100).default(''),
  industryId: id.optional(),
  origin: z.enum(['OFFICIAL', 'USER', 'ADMIN']).optional(),
  /** Include merged aliases (hidden by default). */
  merged: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
})
export const StudentInstitutionsQuery = z.object({ q: z.string().max(200).default(''), regionId: id.optional() })

export type IndustryInput = z.infer<typeof IndustryInput>
export type IndustryPatch = z.infer<typeof IndustryPatch>
export type DirectionPatch = z.infer<typeof DirectionPatch>
export type MergeInput = z.infer<typeof MergeInput>
export type AdminDirectionsQuery = z.infer<typeof AdminDirectionsQuery>
export type StudentInstitutionsQuery = z.infer<typeof StudentInstitutionsQuery>
