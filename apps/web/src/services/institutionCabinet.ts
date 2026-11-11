import {
  INSTITUTION_REVIEW_FIELDS, type AnnouncementDto, type AnnouncementResponseDto, type DistrictDto, type IncomingTrainingRequestDto,
  type InstitutionPassportDto, type InstitutionRequiredField, type InstitutionStudentDto, type RegistryInstitutionType, type RegistryOwnership,
  type InstitutionVacanciesDto, type InstitutionVacancyDto, type StudyConfirmationStatus, type VacancyBroadcastDto, type VacancyBroadcastPreviewDto, type VacancyKind,
} from '@ilmora/shared'
import { api } from '../lib/api'

const id = (s: string) => encodeURIComponent(s)

// ───────────── The passport (ТЗ 4.2) ─────────────

/** The passport as the form edits it: text fields as strings ('' — empty), ids for the lists. */
export interface PassportForm {
  type: RegistryInstitutionType
  ownership: RegistryOwnership | ''
  name: string
  stir: string
  regionId: string
  districtId: string
  address: string
  phone: string
  email: string
  website: string
  directorName: string
  repName: string
  repJobTitle: string
}

export function passportForm(p: InstitutionPassportDto): PassportForm {
  return {
    type: p.type, ownership: p.ownership ?? '', name: p.name, stir: p.stir ?? '', regionId: p.region?.id ?? '', districtId: p.district?.id ?? '',
    address: p.address ?? '', phone: p.phone ?? '', email: p.email ?? '', website: p.website ?? '', directorName: p.directorName ?? '',
    repName: p.representative.name, repJobTitle: p.representative.jobTitle ?? '',
  }
}

/**
 * Only what changed goes to `PATCH /institutions/me`: an emptied optional field is sent as null (cleared), the
 * representative's name and job title together when either changed. A new region without a district clears the old one
 * on the API's side, so the district is sent only when it is chosen.
 */
export function passportPatch(form: PassportForm, before: PassportForm): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const text = (k: keyof PassportForm) => form[k].trim()
  if (form.type !== before.type) out.type = form.type
  if (form.ownership !== before.ownership) out.ownership = form.ownership || null
  if (text('name') !== before.name.trim()) out.name = text('name')
  if (text('stir') !== before.stir.trim() && text('stir')) out.stir = text('stir')
  if (form.regionId !== before.regionId) out.regionId = form.regionId || null
  if (form.districtId !== before.districtId && (form.districtId || form.regionId === before.regionId)) out.districtId = form.districtId || null
  for (const k of ['address', 'phone', 'email', 'website', 'directorName'] as const) if (text(k) !== before[k].trim()) out[k] = text(k) || null
  if (text('repName') !== before.repName.trim() || text('repJobTitle') !== before.repJobTitle.trim()) {
    out.representative = { ...(text('repName') ? { name: text('repName') } : {}), ...(text('repJobTitle') ? { jobTitle: text('repJobTitle') } : {}) }
  }
  return out
}

/** After approval, these fields go to the Super Admin before they show (the workspace keeps working). */
export const reviewedChanged = (patch: Record<string, unknown>) => INSTITUTION_REVIEW_FIELDS.some((k) => k in patch)

/** A direction of the passport as the form edits it. */
export interface DirectionRow { directionId: string; name: string; industryId?: string; department: string; studentsCount: string }

export const directionRows = (p: InstitutionPassportDto): DirectionRow[] =>
  p.directions.map((d) => ({ directionId: d.direction.id, name: d.direction.name, industryId: d.direction.industry.id, department: d.department ?? '', studentsCount: String(d.studentsCount) }))

/** `PUT /institutions/me/directions`: the whole list; rows without a direction or a count are not sent. */
export function directionsBody(rows: DirectionRow[]) {
  return {
    directions: rows
      .filter((r) => r.directionId && Number(r.studentsCount) >= 1)
      .map((r) => ({ directionId: r.directionId, department: r.department.trim() || null, studentsCount: Math.floor(Number(r.studentsCount)) })),
  }
}

/** A direction row the API would refuse: no direction picked, the same direction twice, a count that is not 1 or more. */
export function directionProblems(rows: DirectionRow[]): Record<number, 'direction' | 'twice' | 'count'> {
  const out: Record<number, 'direction' | 'twice' | 'count'> = {}
  const seen = new Set<string>()
  rows.forEach((r, i) => {
    if (!r.directionId) out[i] = 'direction'
    else if (seen.has(r.directionId)) out[i] = 'twice'
    else if (!/^\d+$/.test(r.studentsCount.trim()) || Number(r.studentsCount) < 1) out[i] = 'count'
    seen.add(r.directionId)
  })
  return out
}

/** Which form field a missing required field of `incomplete_profile` points at. */
export const MISSING_FIELD: Record<InstitutionRequiredField, keyof PassportForm | 'directions'> = {
  type: 'type', ownership: 'ownership', name: 'name', stir: 'stir', regionId: 'regionId', districtId: 'districtId', address: 'address', phone: 'phone',
  directorName: 'directorName', directions: 'directions', representativeName: 'repName', representativeJobTitle: 'repJobTitle',
}

// ───────────── Years the API takes ─────────────

const thisYear = (now = new Date()) => now.getUTCFullYear()
/** An offer to a company's request: this year to 10 years ahead (TRAINING_YEARS_AHEAD). */
export const offerYears = (now = new Date()) => Array.from({ length: 11 }, (_, i) => thisYear(now) + i)
/** A graduation announcement: last year to 6 years ahead. */
export const announcementYears = (now = new Date()) => Array.from({ length: 8 }, (_, i) => thisYear(now) - 1 + i)

// ───────────── Calls ─────────────

/** What the institution saw in the list of students: sent with its decision (Н-8). */
export const studySeen = (s: InstitutionStudentDto) => ({ directionId: s.direction?.id ?? null, graduationYear: s.graduationYear ?? null })

// ───────────── «Вакансии компаний» and «Разослать студентам» (ТЗ «Студенты у компании, Вакансии у учреждения», 3) ─────────────

/** A tab is a kind; the other filters apply when set (paid — practice and internships, schedule and experience — jobs). */
export interface InstVacancyFilters { kind: VacancyKind; direction: string; region: string; format: string; paid: string; schedule: string; experience: string }
export const emptyInstVacancyFilters = (kind: VacancyKind = 'PRACTICE'): InstVacancyFilters => ({ kind, direction: '', region: '', format: '', paid: '', schedule: '', experience: '' })
export function instVacancyQuery(f: InstVacancyFilters): string {
  const p = new URLSearchParams({ kind: f.kind })
  const job = f.kind === 'JOB'
  for (const k of ['direction', 'region', 'format'] as const) if (f[k]) p.set(k, f[k])
  if (!job && f.paid) p.set('paid', f.paid)
  if (job && f.schedule) p.set('schedule', f.schedule)
  if (job && f.experience) p.set('experience', f.experience)
  return `?${p.toString()}`
}
/** The institution's own directions a vacancy can be sent on: those of the vacancy's industries (the API checks the same). */
export function broadcastDirections(passport: InstitutionPassportDto, vacancy: Pick<InstitutionVacancyDto, 'directions'>) {
  const industries = new Set(vacancy.directions.map((d) => d.industry.id))
  return passport.directions.filter((d) => industries.has(d.direction.industry.id))
}
/** Years of study a broadcast can choose: a school up to the 11th class, the others up to the 6th year. */
export const broadcastCourses = (type: RegistryInstitutionType) => Array.from({ length: type === 'SCHOOL' ? 11 : 6 }, (_, i) => i + 1)

export const institutionApi = {
  me: () => api<InstitutionPassportDto>('/institutions/me'),
  vacancies: (f: InstVacancyFilters) => api<InstitutionVacanciesDto>(`/institutions/me/vacancies${instVacancyQuery(f)}`),
  broadcastPreview: (vacancyId: string, b: { directionIds: string[]; courses: number[] }) => api<VacancyBroadcastPreviewDto>(`/institutions/me/vacancies/${id(vacancyId)}/broadcast/preview`, { method: 'POST', body: b }),
  broadcast: (vacancyId: string, b: { directionIds: string[]; courses: number[] }) => api<VacancyBroadcastDto>(`/institutions/me/vacancies/${id(vacancyId)}/broadcast`, { method: 'POST', body: b }),
  broadcasts: () => api<VacancyBroadcastDto[]>('/institutions/me/vacancy-broadcasts'),
  update: (patch: Record<string, unknown>) => api<InstitutionPassportDto>('/institutions/me', { method: 'PATCH', body: patch }),
  setDirections: (rows: DirectionRow[]) => api<InstitutionPassportDto>('/institutions/me/directions', { method: 'PUT', body: directionsBody(rows) }),
  submit: () => api<InstitutionPassportDto>('/institutions/me/submit', { method: 'POST' }),
  /** The official districts of a region (SOATO); `regionId` may be the region's slug. */
  districts: (regionId: string) => api<DistrictDto[]>(`/registry/districts?regionId=${id(regionId)}`),

  /** Students who named this institution (ТЗ 4.1): name, course, direction, year — no contacts. */
  students: (status?: StudyConfirmationStatus) => api<InstitutionStudentDto[]>(`/institutions/me/students${status ? `?status=${status}` : ''}`),
  /** «Подтверждаю то, что видел» (Н-8): the direction and the year from the list go along; changed since → 409 study_changed. */
  confirm: (s: InstitutionStudentDto) => api<InstitutionStudentDto[]>(`/institutions/me/students/${id(s.id)}/confirm`, { method: 'POST', body: studySeen(s) }),
  reject: (s: InstitutionStudentDto) => api<InstitutionStudentDto[]>(`/institutions/me/students/${id(s.id)}/reject`, { method: 'POST', body: studySeen(s) }),

  /** Companies' requests in the industries of the institution's directions (ТЗ 5.2). */
  incoming: (industryId?: string) => api<IncomingTrainingRequestDto[]>(`/training-requests${industryId ? `?industryId=${id(industryId)}` : ''}`),
  offer: (requestId: string, o: { count: number; byYear: number; comment: string }) =>
    api<IncomingTrainingRequestDto>(`/training-requests/${id(requestId)}/offers`, { method: 'POST', body: { count: o.count, byYear: o.byYear, comment: o.comment.trim() || null } }),
  myOffers: () => api<IncomingTrainingRequestDto[]>('/institutions/me/offers'),
  withdraw: (offerId: string) => api<unknown>(`/institutions/me/offers/${id(offerId)}/withdraw`, { method: 'POST' }),

  /** Graduation announcements (ТЗ 5.1). */
  announcements: () => api<AnnouncementDto[]>('/institutions/me/announcements'),
  announcement: (annId: string) => api<AnnouncementDto>(`/institutions/me/announcements/${id(annId)}`),
  createAnnouncement: (year: number, lines: { directionId: string; count: number }[]) =>
    api<AnnouncementDto>('/institutions/me/announcements', { method: 'POST', body: { year, lines } }),
  updateLines: (annId: string, lines: { directionId: string; count: number }[]) =>
    api<AnnouncementDto>(`/institutions/me/announcements/${id(annId)}`, { method: 'PATCH', body: { lines } }),
  publish: (annId: string) => api<AnnouncementDto>(`/institutions/me/announcements/${id(annId)}/publish`, { method: 'POST' }),
  close: (annId: string) => api<AnnouncementDto>(`/institutions/me/announcements/${id(annId)}/close`, { method: 'POST' }),
  /** A student's card is not shown to companies in this announcement (or shown again). */
  exclude: (annId: string, studentId: string) => api<AnnouncementDto>(`/institutions/me/announcements/${id(annId)}/exclusions`, { method: 'POST', body: { studentId } }),
  include: (annId: string, studentId: string) => api<AnnouncementDto>(`/institutions/me/announcements/${id(annId)}/exclusions/${id(studentId)}`, { method: 'DELETE' }),
  responses: (annId: string) => api<AnnouncementResponseDto[]>(`/institutions/me/announcements/${id(annId)}/responses`),
  acceptResponse: (responseId: string) => api<AnnouncementResponseDto>(`/institutions/me/announcement-responses/${id(responseId)}/accept`, { method: 'POST' }),
  declineResponse: (responseId: string) => api<AnnouncementResponseDto>(`/institutions/me/announcement-responses/${id(responseId)}/decline`, { method: 'POST' }),
}

/** Lines of an announcement form: a direction of the institution and how many graduate; empty rows are not sent. */
export const announcementLines = (rows: { directionId: string; count: string }[]) =>
  rows.filter((r) => r.directionId && Number(r.count) >= 1).map((r) => ({ directionId: r.directionId, count: Math.floor(Number(r.count)) }))
