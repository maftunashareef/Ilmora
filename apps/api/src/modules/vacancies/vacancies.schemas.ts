import { BROADCAST_COURSE_MAX, hasMarkup, VACANCY_DIRECTIONS_MAX, VACANCY_SEATS_MAX } from '@ilmora/shared'
import { z } from 'zod'
import { isCalendarDate, todayLocal } from '../../common/time'
import { id } from '../registry/registry.schemas'

const text = (max: number) =>
  z.string().transform((s) => s.normalize('NFC').trim()).pipe(z.string().max(max).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' })).transform((s) => s || null)
const today = () => todayLocal()
/** The last day to apply: a real date, not before today in Tashkent. */
const deadline = z.string().refine(isCalendarDate, { message: 'Not a date' }).refine((s) => s >= today(), { message: 'Not before today' })

const fields = {
  kind: z.enum(['PRACTICE', 'INTERNSHIP', 'JOB']),
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
  /** «Работа» (JOB): the monthly salary, so'm, from–to; one amount is `salaryFrom` alone. Never with a stipend. */
  salaryFrom: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  salaryTo: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  duration: text(100).nullable().optional(),
  seats: z.number().int().min(1).max(VACANCY_SEATS_MAX),
  requirements: text(2000).nullable().optional(),
  deadline: deadline.nullable().optional(),
}

/**
 * The pay rules of a vacancy (ТЗ 5.4; «Работа» — ТЗ «Студенты у компании», 5), the same as the database checks: a stipend
 * only when paid and never on a JOB; a JOB is always paid and its salary is from–to («до» not below «от»); a salary only
 * on a JOB. Returns the first broken rule as a path and a message.
 */
export function payIssue(v: { kind: string; paid: boolean; stipend?: number | null; salaryFrom?: number | null; salaryTo?: number | null }): { path: string; message: string } | null {
  if (v.kind === 'JOB') {
    if (!v.paid) return { path: 'paid', message: 'A job is always paid' }
    if (v.stipend != null) return { path: 'stipend', message: 'A job has a salary, not a stipend' }
    if (v.salaryTo != null && v.salaryFrom == null) return { path: 'salaryFrom', message: 'Give the salary «from» first' }
    if (v.salaryTo != null && v.salaryFrom != null && v.salaryTo < v.salaryFrom) return { path: 'salaryTo', message: '«To» is below «from»' }
    return null
  }
  if (v.salaryFrom != null || v.salaryTo != null) return { path: 'salaryFrom', message: 'A salary is only for a job' }
  if (!v.paid && v.stipend != null) return { path: 'stipend', message: 'A stipend needs paid' }
  return null
}

/** ТЗ 5.4: published at once — the company is already approved. */
export const VacancyInput = z.object(fields).strict().superRefine((v, ctx) => {
  const issue = payIssue(v)
  if (issue) ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
})
/** While open; the same rules. */
export const VacancyPatch = z.object(fields).partial().strict()

export const VacanciesQuery = z.object({
  /** Industry id or slug; the web passes the student's own by default (ТЗ 5.4). */
  industry: z.string().trim().max(64).optional(),
  region: z.string().trim().max(64).optional(),
  kind: z.enum(['PRACTICE', 'INTERNSHIP', 'JOB']).optional(),
  format: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).optional(),
})

/** «Вакансии компаний» of an institution (ТЗ «Студенты у компании», 3.1): the tab (kind) and the filters. */
export const InstitutionVacanciesQuery = z.object({
  kind: z.enum(['PRACTICE', 'INTERNSHIP', 'JOB']).optional(),
  /** One direction (an alias stands for its main one). */
  direction: id.optional(),
  region: z.string().trim().max(64).optional(),
  format: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).optional(),
  paid: z.enum(['true', 'false']).optional(),
})

/** «Разослать студентам» (3.2): the institution's own directions of the vacancy's industry, and years of study. */
export const BroadcastInput = z.object({
  directionIds: z.array(id).min(1).max(VACANCY_DIRECTIONS_MAX),
  courses: z.array(z.number().int().min(1).max(BROADCAST_COURSE_MAX)).min(1).max(BROADCAST_COURSE_MAX).transform((c) => [...new Set(c)].sort((a, b) => a - b)),
}).strict()

/** «Откликнуться»: a covering note; the button says «Компания увидит ваши ФИО, контакты и сертификаты». */
export const ApplyInput = z.object({ note: text(1000).nullable().optional(), consent: z.literal(true) }).strict()
/** The company's decision; «просмотрен» is set when the company opens the applications. */
export const ApplicationStatusInput = z.object({ status: z.enum(['INVITED', 'REJECTED']) }).strict()

export type VacancyInput = z.infer<typeof VacancyInput>
export type VacancyPatch = z.infer<typeof VacancyPatch>
export type VacanciesQuery = z.infer<typeof VacanciesQuery>
export type ApplyInput = z.infer<typeof ApplyInput>
export type ApplicationStatusInput = z.infer<typeof ApplicationStatusInput>
export type InstitutionVacanciesQuery = z.infer<typeof InstitutionVacanciesQuery>
export type BroadcastInput = z.infer<typeof BroadcastInput>
