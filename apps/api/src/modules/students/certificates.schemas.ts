import { DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES, hasMarkup } from '@ilmora/shared'
import { z } from 'zod'
import { isCalendarDate } from '../../common/time'

const text = (min: number, max: number) =>
  z.string().transform((s) => s.normalize('NFC').trim().replace(/\s+/g, ' ')).pipe(z.string().min(min).max(max).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' }))
const date = z.string().refine((s) => isCalendarDate(s) && s <= new Date().toISOString().slice(0, 10), { message: 'A real date, not in the future' })

export const CertificateUploadInput = z.object({ contentType: z.enum(DOCUMENT_CONTENT_TYPES), fileSize: z.number().int().min(1).max(DOCUMENT_MAX_BYTES) }).strict()
/** ТЗ 5.5: the file, a title, who issued it, the date (optional). */
export const CertificateInput = z.object({ key: z.string().min(10).max(300), title: text(2, 200), issuer: text(2, 200).nullish(), issuedAt: date.nullish() }).strict()
export const CertificatePatch = z.object({ title: text(2, 200), issuer: text(2, 200).nullable(), issuedAt: date.nullable() }).partial().strict()

export type CertificateUploadInput = z.infer<typeof CertificateUploadInput>
export type CertificateInput = z.infer<typeof CertificateInput>
export type CertificatePatch = z.infer<typeof CertificatePatch>
