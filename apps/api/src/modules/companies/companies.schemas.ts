import { COMPANY_DIRECTIONS_MAX, DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES, hasMarkup, INSTITUTION_NAME_MAX, isStir } from '@ilmora/shared'
import { z } from 'zod'
import { id, typedName } from '../registry/registry.schemas'

const stir = z.string().trim().refine(isStir, { message: 'STIR is exactly 9 digits' })
/** Free text: trimmed, no markup (shown to institutions and students — ТЗ 9.4, XSS); an empty string clears the field. */
const text = (max: number) =>
  z.string().transform((s) => s.normalize('NFC').trim().replace(/[ \t]+/g, ' ')).pipe(
    z.string().max(max).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' }),
  ).transform((s) => s || null)

/** ТЗ 4.3: the STIR and the name start the profile; a STIR already registered → 409 «write to support». */
export const CompanyCreateInput = z.object({ stir, name: typedName(INSTITUTION_NAME_MAX) }).strict()

/** The profile, saved in parts; a missing key leaves the field, `null` or an empty string clears an optional one. */
export const CompanyPatch = z
  .object({
    stir,
    name: typedName(INSTITUTION_NAME_MAX),
    regionId: id.nullable(),
    districtId: id.nullable(),
    address: text(300).nullable(),
    website: z.union([z.literal(''), z.string().trim().max(200).regex(/^https?:\/\/[^\s<>]+$/i, 'Starts with http:// or https://')]).nullable().transform((s) => s || null),
    about: text(2000).nullable(),
    /** The whole list of industries (ТЗ 3.1): one or more on submit. */
    industryIds: z.array(id).max(20),
    /** Optional directions that refine the industries. */
    directionIds: z.array(id).max(COMPANY_DIRECTIONS_MAX),
    representative: z.object({ name: typedName(120), jobTitle: typedName(80), email: z.union([z.literal(''), z.email().max(120)]).nullable().transform((s) => s || null) }).partial().strict(),
  })
  .partial()
  .strict()

export const CertificateUploadInput = z.object({ contentType: z.enum(DOCUMENT_CONTENT_TYPES), fileSize: z.number().int().min(1).max(DOCUMENT_MAX_BYTES) }).strict()
export const CertificateConfirmInput = z.object({ key: z.string().min(10).max(300) }).strict()

export type CompanyCreateInput = z.infer<typeof CompanyCreateInput>
export type CompanyPatch = z.infer<typeof CompanyPatch>
export type CertificateUploadInput = z.infer<typeof CertificateUploadInput>
export type CertificateConfirmInput = z.infer<typeof CertificateConfirmInput>
