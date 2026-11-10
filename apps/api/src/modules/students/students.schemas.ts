import { ABOUT_MAX, hasMarkup, STUDENT_CONSENT_KEYS } from '@ilmora/shared'
import { z } from 'zod'

const noMarkup = (max: number) => z.string().max(max).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' })
const year = z.number().int().min(1990).max(2100)
const institutionType = z.enum(['TECHNIKUM', 'COLLEGE', 'LYCEUM', 'SCHOOL', 'UNIVERSITY', 'CENTER'])

/**
 * The shape of `StudentQuestionnaire` (@ilmora/shared) — types and lengths only; the rules of every step are checked by
 * the same `validateQuestionnaireStep` the web wizard uses. Free text carries no markup (shown to companies, ТЗ 9.4).
 */
export const QuestionnaireInput = z
  .object({
    status: z.enum(['STUDYING', 'APPLYING']).nullable(),
    institutionType: institutionType.nullable(),
    institution: z.object({ id: z.string().max(64).optional(), name: noMarkup(200), region: z.string().max(64) }).strict().nullable(),
    institutionUndecided: z.boolean(),
    course: z.number().int().nullable(),
    direction: z.object({ id: z.string().max(64).optional(), name: noMarkup(100), industryId: z.string().max(64).optional() }).strict().nullable(),
    studyForm: z.enum(['GRANT', 'CONTRACT', 'UNKNOWN']).nullable(),
    contractSum: z.number().nonnegative().max(1_000_000_000).nullable(),
    graduationYear: year.nullable(),
    admissionYear: year.nullable(),
    fullName: noMarkup(120),
    birthDate: z.string().max(10),
    region: z.string().max(64),
    district: noMarkup(120),
    phone: z.string().max(30),
    email: z.string().max(120),
    about: noMarkup(ABOUT_MAX),
    guardianName: noMarkup(120),
    guardianPhone: z.string().max(30),
    guardianConsent: z.boolean(),
    consents: z.partialRecord(z.enum(STUDENT_CONSENT_KEYS), z.boolean()),
  })
  .strict()

export type QuestionnaireInput = z.infer<typeof QuestionnaireInput>
