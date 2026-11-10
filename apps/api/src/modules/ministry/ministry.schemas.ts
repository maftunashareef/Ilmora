import { hasMarkup, MINISTRY_TABLES } from '@ilmora/shared'
import { z } from 'zod'
import { Ownership } from '../../generated/prisma/enums'
import { id, institutionType } from '../registry/registry.schemas'

const text = (min: number, max: number) =>
  z.string().transform((s) => s.normalize('NFC').trim().replace(/\s+/g, ' ')).pipe(z.string().min(min).max(max).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' }))
const optionalEmail = z.union([z.literal(''), z.email().max(120)]).transform((s) => s || null)

export const MinistryAccountInput = z
  .object({ login: z.string().min(3).max(32), name: text(2, 120), jobTitle: text(2, 120).optional(), email: optionalEmail.optional() })
  .strict()
export const MinistryAccountPatch = z.object({ name: text(2, 120), jobTitle: text(2, 120).nullable(), email: optionalEmail.nullable() }).partial().strict()

export type MinistryAccountInput = z.infer<typeof MinistryAccountInput>
export type MinistryAccountPatch = z.infer<typeof MinistryAccountPatch>

const ownership = z.enum(Object.values(Ownership) as [Ownership, ...Ownership[]])
const page = z.coerce.number().int().min(1).max(10_000).optional()
const year = z.coerce.number().int().min(2000).max(2100)

/** Filters of the figures (ТЗ 7.3): region (id or slug), type, ownership, year. Query strings: unknown keys are ignored. */
export const StatsQuery = z.object({ regionId: id.optional(), type: institutionType.optional(), ownership: ownership.optional(), year: year.optional() })
export const ExportQuery = StatsQuery.extend({ table: z.enum(MINISTRY_TABLES), lang: z.enum(['uz', 'ru', 'en']).default('ru') })
export const MinistryInstitutionsQuery = z.object({
  q: z.string().max(200).optional(), type: institutionType.optional(), ownership: ownership.optional(), regionId: id.optional(), industryId: id.optional(),
  status: z.enum(['unclaimed', 'pending', 'approved', 'rejected', 'student']).optional(), page,
})
export const MinistryCompaniesQuery = z.object({ q: z.string().max(200).optional(), industryId: id.optional(), regionId: id.optional(), status: z.enum(['approved', 'pending']).optional(), page })

export type StatsQuery = z.infer<typeof StatsQuery>
export type ExportQuery = z.infer<typeof ExportQuery>
export type MinistryInstitutionsQuery = z.infer<typeof MinistryInstitutionsQuery>
export type MinistryCompaniesQuery = z.infer<typeof MinistryCompaniesQuery>
