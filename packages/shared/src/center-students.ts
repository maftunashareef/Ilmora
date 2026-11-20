import { translate, type TKey } from './i18n.js'
import { ageOn } from './questionnaire.js'
import type { RegistryInstitutionType } from './registry.js'
import type { Lang } from './types.js'

/**
 * Students of a center (ТЗ 2026-11-18 «Студенты центров», разделы 4–5, 8): the center's own table of its students, the
 * invitation they accept, the «ученик школы №N» line, the group journal and homework. Pure rules shared by the API (which
 * enforces them) and the web app (which shows them).
 */

// ───────── the table ─────────

/** STUDYING — учится, PAUSED — на паузе, LEFT — ушёл (the record goes to the archive tab, its history is kept). */
export const CENTER_STUDENT_STATUSES = ['STUDYING', 'PAUSED', 'LEFT'] as const
export type CenterStudentStatus = (typeof CENTER_STUDENT_STATUSES)[number]
/** CENTER — added by the center (studies offline, pays the center); ILMORA — came through a subscription, added by itself. */
export const CENTER_STUDENT_SOURCES = ['CENTER', 'ILMORA'] as const
export type CenterStudentSource = (typeof CENTER_STUDENT_SOURCES)[number]

/** A person under 18 needs a parent's name and phone; the invitation goes to the parent's phone. */
export const ADULT_AGE = 18
/** Under 18 on `today` (YYYY-MM-DD in Tashkent); the questionnaire's `ageOn` counts the years. Unknown date — not a minor. */
export const isMinorOn = (birthDate: string | null | undefined, today: string): boolean => {
  if (!birthDate) return false
  const age = ageOn(birthDate, new Date(`${today}T00:00:00.000Z`))
  return age !== null && age < ADULT_AGE
}

/** A class at school is 1–11; a year at a university, college or technikum is 1–6. */
export const STUDY_YEAR_MAX = 11
export const FULL_NAME_MAX = 120
export const INSTITUTION_TEXT_MAX = 200

/** Attendance below this share is what the «посещаемость ниже N%» filter usually asks for; the center may type any N. */
export const ATTENDANCE_FILTER_DEFAULT = 75

/** Whole percent of lessons attended, or null when there was no lesson yet (nothing to count). */
export const attendancePercent = (attended: number, total: number): number | null => (total > 0 ? Math.round((Math.min(attended, total) / total) * 100) : null)

// ───────── invitations (4.3) ─────────

/** A link lives 7 days, works once, and may be sent again at most 3 times after the first one. */
export const INVITE_TTL_DAYS = 7
export const INVITE_RESENDS_MAX = 3
export const INVITE_SENDS_MAX = 1 + INVITE_RESENDS_MAX
/** none — not invited yet; invited — a link is out and alive; accepted — linked to the student's account; expired. */
export type InviteState = 'none' | 'invited' | 'accepted' | 'expired'
export function inviteState(r: { invitedAt?: string | Date | null; inviteExpiresAt?: string | Date | null; inviteAcceptedAt?: string | Date | null }, now: Date = new Date()): InviteState {
  if (r.inviteAcceptedAt) return 'accepted'
  if (!r.invitedAt || !r.inviteExpiresAt) return 'none'
  return new Date(r.inviteExpiresAt).getTime() > now.getTime() ? 'invited' : 'expired'
}
/** The web page that opens an invitation. The token is in the fragment: browsers never send it to a server or in Referer. */
export const INVITE_PATH = '/invite'
export const inviteUrl = (webOrigin: string, token: string): string => `${webOrigin.replace(/\/$/, '')}${INVITE_PATH}#${token}`

// ───────── «Ученик школы №N, 9 класс» (4.4) ─────────

export interface StudyLabelInput {
  institutionType: RegistryInstitutionType | null | undefined
  institutionName: string | null | undefined
  studyYear: number | null | undefined
  centerName: string
}
/**
 * Where the student studies, by the type of the institution: a school counts classes, a lyceum, college, technikum or
 * university — years («курс»). Without an institution: «Учится в центре <центр>». Shown to the center, the teachers of
 * the student's groups, the student and (by the registry's rules) companies — never on a public page.
 */
export function studyLabel(lang: Lang, s: StudyLabelInput): string {
  const name = s.institutionName?.trim()
  if (!name || s.institutionType === 'TRAINING_CENTER') return translate(lang, 'cs.label.center', { center: s.centerName })
  const year = s.studyYear && Number.isInteger(s.studyYear) && s.studyYear > 0 ? s.studyYear : null
  const kind = s.institutionType === 'SCHOOL' ? 'school' : s.institutionType === 'LYCEUM' ? 'lyceum' : s.institutionType ? 'higher' : 'other'
  if (year === null) return translate(lang, `cs.label.${kind}` as TKey, { name })
  return translate(lang, `cs.label.${kind}Year` as TKey, { name, n: year })
}

// ───────── Excel (4.2): one template for import and export ─────────

/** Columns of the import template in order; the export adds the computed ones after them. `required` marks a must. */
export const IMPORT_COLUMNS = [
  { key: 'fullName', label: 'cs.col.fullName', required: true },
  { key: 'phone', label: 'cs.col.phone', required: false },
  { key: 'birthDate', label: 'cs.col.birthDate', required: true },
  { key: 'institution', label: 'cs.col.institution', required: false },
  { key: 'studyYear', label: 'cs.col.studyYear', required: false },
  { key: 'groups', label: 'cs.col.groups', required: false },
  { key: 'parentName', label: 'cs.col.parentName', required: false },
  { key: 'parentPhone', label: 'cs.col.parentPhone', required: false },
  { key: 'startedOn', label: 'cs.col.startedOn', required: false },
] as const
export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]['key']
export const EXPORT_EXTRA_COLUMNS = [
  { key: 'status', label: 'cs.col.status' },
  { key: 'source', label: 'cs.col.source' },
  { key: 'attendance', label: 'cs.col.attendance' },
  { key: 'invite', label: 'cs.col.invite' },
  { key: 'parentConsent', label: 'cs.col.parentConsent' },
] as const
/** At most this many rows in one file; a bigger file is refused whole. */
export const IMPORT_MAX_ROWS = 1000
/** The file itself (an .xlsx of 1000 rows is far smaller). */
export const IMPORT_MAX_BYTES = 512 * 1024
/** Several groups in one cell are separated by «;» (a comma may be part of a course title). */
export const GROUPS_SEPARATOR = ';'

/** Why a row of the file is refused; the web app shows the dictionary text `cs.err.<code>`. */
export const IMPORT_ROW_ERRORS = [
  'fullName', 'phone', 'phoneRequired', 'phoneTaken', 'phoneTwice', 'birthDate', 'studyYear', 'parentName', 'parentPhone', 'startedOn', 'group', 'groupAmbiguous', 'institution',
] as const
export type ImportRowError = (typeof IMPORT_ROW_ERRORS)[number]

/** Text typed for a date in Excel: 31.12.2010, 2010-12-31, or the day number Excel keeps for a date cell. */
export function parseSheetDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  let y: number, m: number, d: number
  let match: RegExpMatchArray | null
  if ((match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if (/^\d{4,6}(\.\d+)?$/.test(text)) {
    // Excel's day number (1900 system): day 25569 is 1970-01-01.
    const serial = Math.floor(Number(text))
    if (serial < 1 || serial > 2_958_465) return null
    const date = new Date((serial - 25569) * 86_400_000)
    return date.toISOString().slice(0, 10)
  } else return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

// ───────── group journal (5) ─────────

/** Marks of the center's own students: был, не был, опоздал. ILMORA students are marked by QR and read-only here. */
export const JOURNAL_MARKS = ['PRESENT', 'ABSENT', 'LATE'] as const
export type JournalMark = (typeof JOURNAL_MARKS)[number]
/** «Опоздал» still counts as attended. */
export const countsAsAttended = (mark: string | null | undefined): boolean => mark === 'PRESENT' || mark === 'LATE'

// ───────── homework (8, first stage: text and links) ─────────

export const HOMEWORK_TITLE_MAX = 200
export const HOMEWORK_DESCRIPTION_MAX = 5000
export const HOMEWORK_LINKS_MAX = 10
export const HOMEWORK_TEXT_MAX = 10_000
export const HOMEWORK_COMMENT_MAX = 2000
/** How a student may hand the work in. ZIP comes with the second stage (8.4) and is not accepted yet. */
export const HOMEWORK_SUBMIT_MODES = ['TEXT', 'LINK'] as const
export type HomeworkSubmitMode = (typeof HOMEWORK_SUBMIT_MODES)[number]
export const HOMEWORK_GRADES = [1, 2, 3, 4, 5] as const

/** The deadline for one student: the homework's, or the later one the teacher gave this student. */
export function homeworkDeadline(dueAt: string | Date, extendedTo?: string | Date | null): Date {
  const due = new Date(dueAt)
  if (!extendedTo) return due
  const ext = new Date(extendedTo)
  return ext.getTime() > due.getTime() ? ext : due
}
/** Before the student's deadline the work can be handed in, and handed in again. */
export const canSubmitHomework = (dueAt: string | Date, extendedTo: string | Date | null | undefined, now: Date = new Date()): boolean =>
  now.getTime() <= homeworkDeadline(dueAt, extendedTo).getTime()

/** For the teacher's list: not handed in, handed in on time, late (after the homework's own deadline, on an extension). */
export type HomeworkState = 'missing' | 'submitted' | 'late'
export function homeworkState(dueAt: string | Date, lastSubmittedAt: string | Date | null | undefined): HomeworkState {
  if (!lastSubmittedAt) return 'missing'
  return new Date(lastSubmittedAt).getTime() > new Date(dueAt).getTime() ? 'late' : 'submitted'
}
