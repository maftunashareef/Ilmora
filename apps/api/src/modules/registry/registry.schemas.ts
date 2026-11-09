import { DIRECTION_NAME_MAX, hasMarkup, INSTITUTION_NAME_MAX, type InstitutionType, STUDENT_ADDABLE_TYPES } from '@ilmora/shared'
import { z } from 'zod'

const id = z.string().trim().min(1).max(64)
const INSTITUTION_TYPES = ['TECHNIKUM', 'COLLEGE', 'LYCEUM', 'SCHOOL', 'UNIVERSITY', 'CENTER'] as const satisfies readonly InstitutionType[]
/** A name a user types: trimmed, inner spaces collapsed, no markup (shown everywhere — ТЗ 9.4, XSS). */
const typedName = (max: number) =>
  z.string().transform((s) => s.normalize('NFC').trim().replace(/\s+/g, ' ')).pipe(
    z.string().min(2).max(max).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' }),
  )

// Query strings: unknown parameters are ignored (stripped), not rejected — browsers and caches add their own.
export const DistrictsQuery = z.object({ regionId: id })
export const DirectionsQuery = z.object({ q: z.string().max(100).default(''), industryId: id.optional() })
export const InstitutionsQuery = z.object({ q: z.string().max(INSTITUTION_NAME_MAX).default(''), type: z.enum(INSTITUTION_TYPES).optional(), regionId: id.optional() })

export const DirectionInput = z.object({ name: typedName(DIRECTION_NAME_MAX), industryId: id }).strict()

export const StudentInstitutionInput = z
  .object({ name: typedName(INSTITUTION_NAME_MAX), type: z.enum(INSTITUTION_TYPES), regionId: id, districtId: id.optional() })
  .strict()
  .refine((v) => STUDENT_ADDABLE_TYPES.includes(v.type), { path: ['type'], message: 'A student can add a technikum, lyceum, school or university' })

export type DistrictsQuery = z.infer<typeof DistrictsQuery>
export type DirectionsQuery = z.infer<typeof DirectionsQuery>
export type InstitutionsQuery = z.infer<typeof InstitutionsQuery>
export type DirectionInput = z.infer<typeof DirectionInput>
export type StudentInstitutionInput = z.infer<typeof StudentInstitutionInput>
