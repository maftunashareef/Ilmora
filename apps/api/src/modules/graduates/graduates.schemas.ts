import { hasMarkup, TRAINING_COUNT_MAX } from '@ilmora/shared'
import { z } from 'zod'
import { id } from '../registry/registry.schemas'

const thisYear = () => new Date().getUTCFullYear()
const year = z.number().int().refine((y) => y >= thisYear() - 1 && y <= thisYear() + 6, { message: 'From last year to 6 years ahead' })
const count = z.number().int().min(1).max(TRAINING_COUNT_MAX)
const lines = z.array(z.object({ directionId: id, count }).strict()).min(1).max(100)

/** ТЗ 5.1: the year of graduation and, per direction of the institution, how many graduate. */
export const AnnouncementInput = z.object({ year, lines }).strict()
/** Lines can change after publication too; a new industry is notified, the companies notified before are not again. */
export const AnnouncementPatch = z.object({ lines }).strict()
export const ExclusionInput = z.object({ studentId: id }).strict()

/** ТЗ 5.1 «Откликнуться»: which lines, how many people from each, a comment. */
export const ResponseInput = z
  .object({
    lines: z.array(z.object({ lineId: id, wantedCount: count }).strict()).min(1).max(100),
    comment: z.string().transform((s) => s.normalize('NFC').trim()).pipe(z.string().max(1000).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' })).transform((s) => s || null).nullish(),
  })
  .strict()
export const InviteInput = z.object({ announcementId: id }).strict()
export const AnnouncementsQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() })

/**
 * The company's «Студенты» filters (ТЗ «Студенты у компании», 2.2): a direction (an alias stands for its main one), the
 * institution's type and region, the year of study and the year of graduation.
 */
export const CompanyStudentsQuery = z.object({
  direction: id.optional(),
  type: z.enum(['TECHNIKUM', 'COLLEGE', 'LYCEUM', 'SCHOOL', 'UNIVERSITY', 'TRAINING_CENTER']).optional(),
  region: z.string().trim().max(64).optional(),
  course: z.coerce.number().int().min(1).max(11).optional(),
  graduationYear: z.coerce.number().int().min(2000).max(2100).optional(),
})
export const CompanyStudentsPageQuery = CompanyStudentsQuery.extend({ page: z.coerce.number().int().min(1).max(1000).default(1) })

export type AnnouncementInput = z.infer<typeof AnnouncementInput>
export type CompanyStudentsQuery = z.infer<typeof CompanyStudentsQuery>
export type CompanyStudentsPageQuery = z.infer<typeof CompanyStudentsPageQuery>
export type AnnouncementPatch = z.infer<typeof AnnouncementPatch>
export type ResponseInput = z.infer<typeof ResponseInput>
export type InviteInput = z.infer<typeof InviteInput>
export type AnnouncementsQuery = z.infer<typeof AnnouncementsQuery>
