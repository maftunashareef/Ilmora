import { hasMarkup, INSTITUTION_DIRECTIONS_MAX, INSTITUTION_NAME_MAX, isStir, STUDENTS_PER_DIRECTION_MAX } from '@ilmora/shared'
import { z } from 'zod'
import { Ownership } from '../../generated/prisma/enums'
import { id, institutionType, typedName } from '../registry/registry.schemas'

const stir = z.string().trim().refine(isStir, { message: 'STIR is exactly 9 digits' })
const ownership = z.enum(Object.values(Ownership) as [Ownership, ...Ownership[]])
/** Free text of the profile: trimmed, no markup (ТЗ 9.4, XSS); an empty string clears the field. */
const text = (max: number) =>
  z.string().transform((s) => s.normalize('NFC').trim().replace(/\s+/g, ' ')).pipe(
    z.string().max(max).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' }),
  ).transform((s) => s || null)
const personName = typedName(120)

/** Step 2 of ТЗ 4.2: the STIR; type and name only when the STIR is not in the registry and a new record is started. */
export const ClaimInput = z.object({ stir, type: institutionType.optional(), name: typedName(INSTITUTION_NAME_MAX).optional() }).strict()

/**
 * The profile, saved in parts (a draft does not have to be complete — the API checks required fields on submit).
 * A missing key leaves the field as it is; `null` (or an empty string) clears an optional one.
 */
export const InstitutionPatch = z
  .object({
    type: institutionType,
    ownership: ownership.nullable(),
    name: typedName(INSTITUTION_NAME_MAX),
    stir,
    regionId: id.nullable(),
    districtId: id.nullable(),
    address: text(300).nullable(),
    phone: z.string().trim().max(30).nullable(),
    email: z.union([z.literal(''), z.email().max(120)]).nullable().transform((s) => s || null),
    website: z.union([z.literal(''), z.string().trim().max(200).regex(/^https?:\/\/[^\s<>]+$/i, 'Starts with http:// or https://')]).nullable().transform((s) => s || null),
    directorName: text(120).nullable(),
    representative: z.object({ name: personName, jobTitle: typedName(80) }).partial().strict(),
  })
  .partial()
  .strict()

/** The whole list of the institution's directions (ТЗ 4.2: at least one on submit; each with its number of students). */
export const DirectionsInput = z
  .object({
    directions: z
      .array(z.object({ directionId: id, department: text(120).nullish(), studentsCount: z.number().int().min(1).max(STUDENTS_PER_DIRECTION_MAX) }).strict())
      .max(INSTITUTION_DIRECTIONS_MAX),
  })
  .strict()

export type ClaimInput = z.infer<typeof ClaimInput>
export type InstitutionPatch = z.infer<typeof InstitutionPatch>
export type DirectionsInput = z.infer<typeof DirectionsInput>
