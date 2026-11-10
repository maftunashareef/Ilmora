import type { InstitutionType } from './institutions.js'
import { STUDENT_INSTITUTION_TYPES } from './registry.js'
import { isUzRegion } from './organization.js'
import { normalizeUzPhone } from './phone.js'
import type { TKey } from './i18n.js'

/**
 * The student questionnaire (ТЗ 4.1): after the account exists (step 0), the student says whether they already study or
 * want to apply (step 1), describes that study (2a / 2b), gives personal data (3) and the consents of section 8 (4).
 * Shared by the web wizard and the API, so both check the same rules.
 */
export type StudyStatus = 'STUDYING' | 'APPLYING'
export type StudyForm = 'GRANT' | 'CONTRACT'
/** Applicants may not know yet how they will pay. */
export type PlannedStudyForm = StudyForm | 'UNKNOWN'

/** Step 2a offers technikum, university and school; step 2b technikum, lyceum and university (the API's own lists). */
export const STUDYING_TYPES: readonly InstitutionType[] = STUDENT_INSTITUTION_TYPES.studying
export const APPLYING_TYPES: readonly InstitutionType[] = STUDENT_INSTITUTION_TYPES.applying

/** A registry institution (`id`) or one the student typed (`name` + `region`, saved to the registry, ТЗ 3.5). */
export interface InstitutionChoice {
  id?: string
  name: string
  region: string
}

/** A direction of the shared directory (ТЗ 3.2): picked from the suggestions or just added there with its industry. */
export interface DirectionChoice {
  id?: string
  name: string
  industryId?: string
}

export interface StudentQuestionnaire {
  status: StudyStatus | null
  institutionType: InstitutionType | null
  institution: InstitutionChoice | null
  /** Applicants only: "not decided yet" instead of an institution. */
  institutionUndecided: boolean
  /** Year of study 1–6; for a school, the grade 1–11. */
  course: number | null
  direction: DirectionChoice | null
  studyForm: PlannedStudyForm | null
  /** Contract amount per year, in so‘m. */
  contractSum: number | null
  graduationYear: number | null
  admissionYear: number | null
  fullName: string
  /** YYYY-MM-DD */
  birthDate: string
  region: string
  district: string
  phone: string
  email: string
  about: string
  guardianName: string
  guardianPhone: string
  guardianConsent: boolean
  /** Section 8 consents by key; every mark starts unticked. */
  consents: Record<string, boolean>
}

export const EMPTY_QUESTIONNAIRE: StudentQuestionnaire = {
  status: null, institutionType: null, institution: null, institutionUndecided: false, course: null, direction: null,
  studyForm: null, contractSum: null, graduationYear: null, admissionYear: null, fullName: '', birthDate: '', region: '',
  district: '', phone: '', email: '', about: '', guardianName: '', guardianPhone: '', guardianConsent: false, consents: {},
}

export const ABOUT_MAX = 500
export const QUESTIONNAIRE_STEPS = 4

export type QuestionnaireField =
  | 'status' | 'institutionType' | 'institution' | 'course' | 'direction' | 'studyForm' | 'contractSum' | 'graduationYear'
  | 'admissionYear' | 'fullName' | 'birthDate' | 'region' | 'district' | 'phone' | 'email' | 'about' | 'guardianName'
  | 'guardianPhone' | 'guardianConsent' | 'consents'
export type QuestionnaireErrors = Partial<Record<QuestionnaireField, TKey>>

/** Highest year of study or school grade for an institution type. */
export const maxCourse = (type: InstitutionType | null): number => (type === 'SCHOOL' ? 11 : 6)

/** Full years between a YYYY-MM-DD birth date and `today`; null when the date is not a real past date. */
export function ageOn(birthDate: string, today: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const born = new Date(Date.UTC(y, mo - 1, d))
  if (born.getUTCFullYear() !== y || born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return null
  const t = { y: today.getUTCFullYear(), m: today.getUTCMonth() + 1, d: today.getUTCDate() }
  if (y > t.y || (y === t.y && (mo > t.m || (mo === t.m && d > t.d)))) return null
  return t.y - y - (t.m < mo || (t.m === mo && t.d < d) ? 1 : 0)
}

/** A minor needs a parent or legal guardian and their consent (ТЗ 4.1 step 3). */
export const isMinor = (q: Pick<StudentQuestionnaire, 'birthDate'>, today: Date): boolean => {
  const age = ageOn(q.birthDate, today)
  return age !== null && age < 18
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Errors of one step (1–4) as dictionary keys; an empty object means the step is complete.
 * `requiredConsents` are the section 8 marks that must be ticked (the list itself lives with the texts).
 */
export function validateQuestionnaireStep(step: number, q: StudentQuestionnaire, today: Date, requiredConsents: readonly string[] = []): QuestionnaireErrors {
  const e: QuestionnaireErrors = {}
  const year = today.getUTCFullYear()
  if (step === 1) {
    if (!q.status) e.status = 'q.err.status'
  } else if (step === 2) {
    const studying = q.status === 'STUDYING'
    const types = studying ? STUDYING_TYPES : APPLYING_TYPES
    const school = q.institutionType === 'SCHOOL'
    if (!q.institutionType || !types.includes(q.institutionType)) e.institutionType = 'q.err.institutionType'
    const undecided = !studying && q.institutionUndecided
    if (!undecided && (!q.institution || q.institution.name.trim().length < 2 || !isUzRegion(q.institution.region))) e.institution = 'q.err.institution'
    if (studying) {
      if (!q.course || !Number.isInteger(q.course) || q.course < 1 || q.course > maxCourse(q.institutionType)) e.course = school ? 'q.err.grade' : 'q.err.course'
      if (!school && !q.direction?.name.trim()) e.direction = 'q.err.direction'
      if (!school && q.studyForm !== 'GRANT' && q.studyForm !== 'CONTRACT') e.studyForm = 'q.err.studyForm'
      if (!school && q.studyForm === 'CONTRACT' && !(q.contractSum && q.contractSum > 0)) e.contractSum = 'q.err.contractSum'
      if (!q.graduationYear || q.graduationYear < year || q.graduationYear > year + 12) e.graduationYear = 'q.err.graduationYear'
    } else {
      if (!q.admissionYear || q.admissionYear < year || q.admissionYear > year + 6) e.admissionYear = 'q.err.admissionYear'
      if (!q.direction?.name.trim()) e.direction = 'q.err.direction'
      if (!q.studyForm) e.studyForm = 'q.err.plannedForm'
      if (q.contractSum !== null && !(q.contractSum > 0)) e.contractSum = 'q.err.contractSum'
    }
  } else if (step === 3) {
    if (q.fullName.trim().length < 5 || !q.fullName.trim().includes(' ')) e.fullName = 'q.err.fullName'
    const age = ageOn(q.birthDate, today)
    if (age === null || age < 6 || age > 90) e.birthDate = 'q.err.birthDate'
    if (!isUzRegion(q.region)) e.region = 'auth.err.region'
    if (q.district.trim().length < 2) e.district = 'q.err.district'
    if (!normalizeUzPhone(q.phone).ok) e.phone = 'auth.err.phone'
    if (q.email.trim() && !EMAIL_RE.test(q.email.trim())) e.email = 'q.err.email'
    if (q.about.length > ABOUT_MAX) e.about = 'q.err.about'
    if (age !== null && age < 18) {
      if (q.guardianName.trim().length < 5 || !q.guardianName.trim().includes(' ')) e.guardianName = 'q.err.guardianName'
      if (!normalizeUzPhone(q.guardianPhone).ok) e.guardianPhone = 'auth.err.phone'
      if (!q.guardianConsent) e.guardianConsent = 'q.err.guardianConsent'
    }
  } else if (step === 4) {
    if (requiredConsents.some((k) => !q.consents[k])) e.consents = 'q.err.consents'
  }
  return e
}

/** The first step (1–4) that still has errors, or null when the whole questionnaire is complete. */
export function firstIncompleteStep(q: StudentQuestionnaire, today: Date, requiredConsents: readonly string[] = []): number | null {
  for (let s = 1; s <= QUESTIONNAIRE_STEPS; s++) if (Object.keys(validateQuestionnaireStep(s, q, today, requiredConsents)).length) return s
  return null
}
