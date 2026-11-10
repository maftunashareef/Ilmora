import { hasMarkup, VACANCY_DIRECTIONS_MAX, VACANCY_SEATS_MAX } from '@ilmora/shared'
import { z } from 'zod'
import { isCalendarDate } from '../../common/time'
import { id } from '../registry/registry.schemas'

const text = (max: number) =>
  z.string().transform((s) => s.normalize('NFC').trim()).pipe(z.string().max(max).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' })).transform((s) => s || null)
const today = () => new Date().toISOString().slice(0, 10)
/** The last day to apply: a real date, not before today (UTC). */
const deadline = z.string().refine(isCalendarDate, { message: 'Not a date' }).refine((s) => s >= today(), { message: 'Not before today' })

const fields = {
  kind: z.enum(['PRACTICE', 'INTERNSHIP']),
  title: z.string().transform((s) => s.normalize('NFC').trim().replace(/\s+/g, ' ')).pipe(z.string().min(2).max(200).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' })),
  directionIds: z.array(id).min(1).max(VACANCY_DIRECTIONS_MAX),
  /** Region id or the web app's slug. */
  region: z.string().trim().min(1).max(64),
  districtId: id.nullable().optional(),
  address: text(300).nullable().optional(),
  format: z.enum(['ONSITE', 'REMOTE', 'HYBRID']),
  paid: z.boolean(),
  /** Monthly stipend, so'm; only with `paid`. */
  stipend: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  duration: text(100).nullable().optional(),
  seats: z.number().int().min(1).max(VACANCY_SEATS_MAX),
  requirements: text(2000).nullable().optional(),
  deadline: deadline.nullable().optional(),
}

/** ТЗ 5.4: published at once — the company is already approved. */
export const VacancyInput = z.object(fields).strict().refine((v) => v.paid || v.stipend == null, { message: 'A stipend needs paid', path: ['stipend'] })
/** While open; the same rules. */
export const VacancyPatch = z.object(fields).partial().strict()

export const VacanciesQuery = z.object({
  /** Industry id or slug; the web passes the student's own by default (ТЗ 5.4). */
  industry: z.string().trim().max(64).optional(),
  region: z.string().trim().max(64).optional(),
  kind: z.enum(['PRACTICE', 'INTERNSHIP']).optional(),
  format: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).optional(),
})

/** «Откликнуться»: a covering note; the button says «Компания увидит ваши ФИО, контакты и сертификаты». */
export const ApplyInput = z.object({ note: text(1000).nullable().optional(), consent: z.literal(true) }).strict()
/** The company's decision; «просмотрен» is set when the company opens the applications. */
export const ApplicationStatusInput = z.object({ status: z.enum(['INVITED', 'REJECTED']) }).strict()

export type VacancyInput = z.infer<typeof VacancyInput>
export type VacancyPatch = z.infer<typeof VacancyPatch>
export type VacanciesQuery = z.infer<typeof VacanciesQuery>
export type ApplyInput = z.infer<typeof ApplyInput>
export type ApplicationStatusInput = z.infer<typeof ApplicationStatusInput>
