import {
  COMPANY_REVIEW_FIELDS, DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES, type CompanyAnnouncementDto, type CompanyContactDto, type CompanyProfileDto,
  type CompanyRequiredField, type CompanyVacancyDto, type ContractHelpCardDto, type DocumentLinkDto, type DocumentUploadDto, type TrainingRequestDto,
  type VacancyApplicationDto, type VacancyKind, type WorkFormat,
} from '@ilmora/shared'
import { api } from '../lib/api'

const id = (s: string) => encodeURIComponent(s)
const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams(Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '').map(([k, v]) => [k, String(v)]))
  return p.toString() ? `?${p}` : ''
}

// ───────────── The profile (ТЗ 4.3) ─────────────

export interface CompanyForm {
  name: string
  stir: string
  regionId: string
  districtId: string
  address: string
  website: string
  about: string
  industryIds: string[]
  directions: { id: string; name: string }[]
  repName: string
  repJobTitle: string
  repEmail: string
}

export const companyForm = (p: CompanyProfileDto): CompanyForm => ({
  name: p.name, stir: p.stir, regionId: p.region?.id ?? '', districtId: p.district?.id ?? '', address: p.address ?? '', website: p.website ?? '', about: p.about ?? '',
  industryIds: p.industries.map((i) => i.id), directions: p.directions.map((d) => ({ id: d.id, name: d.name })),
  repName: p.representative.name, repJobTitle: p.representative.jobTitle ?? '', repEmail: p.representative.email ?? '',
})

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** Only what changed goes to `PATCH /companies/me`; lists go whole, an emptied text is cleared, the representative together. */
export function companyPatch(form: CompanyForm, before: CompanyForm): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const text = (k: 'name' | 'stir' | 'address' | 'website' | 'about' | 'repName' | 'repJobTitle' | 'repEmail') => form[k].trim()
  if (text('name') !== before.name.trim()) out.name = text('name')
  if (text('stir') !== before.stir.trim() && text('stir')) out.stir = text('stir')
  if (form.regionId !== before.regionId) out.regionId = form.regionId || null
  if (form.districtId !== before.districtId && (form.districtId || form.regionId === before.regionId)) out.districtId = form.districtId || null
  for (const k of ['address', 'website', 'about'] as const) if (text(k) !== before[k].trim()) out[k] = text(k) || null
  if (!sameSet(form.industryIds, before.industryIds)) out.industryIds = form.industryIds
  const dirs = form.directions.map((d) => d.id)
  if (!sameSet(dirs, before.directions.map((d) => d.id))) out.directionIds = dirs
  if (text('repName') !== before.repName.trim() || text('repJobTitle') !== before.repJobTitle.trim() || text('repEmail') !== before.repEmail.trim()) {
    out.representative = { ...(text('repName') ? { name: text('repName') } : {}), ...(text('repJobTitle') ? { jobTitle: text('repJobTitle') } : {}), email: text('repEmail') || null }
  }
  return out
}

/** After approval the name, STIR and industries go to the Super Admin before they show. */
export const companyReviewedChanged = (patch: Record<string, unknown>) => COMPANY_REVIEW_FIELDS.some((k) => k in patch) || 'industryIds' in patch

/** The state-registration certificate: PDF, JPG or PNG up to 10 MB (the API checks the first bytes too). */
export function certificateProblem(file: { type: string; size: number }): 'type' | 'size' | null {
  if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) return 'type'
  return file.size > DOCUMENT_MAX_BYTES ? 'size' : null
}

export const COMPANY_MISSING_LABEL: Record<CompanyRequiredField, string> = {
  stir: 'auth.org.stir', name: 'inst.p.name', regionId: 'min.filter.region', address: 'min.inst.address', industries: 'rev.industries',
  certificate: 'co.p.certificate', representativeName: 'auth.org.repName', representativeJobTitle: 'auth.position',
}

// ───────────── Vacancies (ТЗ 5.4) ─────────────

export interface VacancyForm {
  kind: VacancyKind; title: string; directions: { id: string; name: string }[]; region: string; address: string; format: WorkFormat
  paid: boolean; stipend: string; duration: string; seats: string; requirements: string; deadline: string
}
export const emptyVacancy = (): VacancyForm => ({ kind: 'PRACTICE', title: '', directions: [], region: '', address: '', format: 'ONSITE', paid: false, stipend: '', duration: '', seats: '1', requirements: '', deadline: '' })
export const vacancyForm = (v: CompanyVacancyDto): VacancyForm => ({
  kind: v.kind, title: v.title, directions: v.directions.map((d) => ({ id: d.id, name: d.name })), region: v.region.id, address: v.address ?? '', format: v.format,
  paid: v.paid, stipend: v.stipend ? String(v.stipend) : '', duration: v.duration ?? '', seats: String(v.seats), requirements: v.requirements ?? '', deadline: v.deadline ?? '',
})

/** The body of a new vacancy or of an edit; a stipend only when paid. */
export function vacancyBody(f: VacancyForm) {
  return {
    kind: f.kind, title: f.title.trim(), directionIds: f.directions.map((d) => d.id), region: f.region, address: f.address.trim() || null, format: f.format,
    paid: f.paid, stipend: f.paid && Number(f.stipend) >= 1 ? Math.floor(Number(f.stipend)) : null, duration: f.duration.trim() || null,
    seats: Math.floor(Number(f.seats)), requirements: f.requirements.trim() || null, deadline: f.deadline || null,
  }
}

/** What the API would refuse, checked before sending. `today` is YYYY-MM-DD in Tashkent. */
export function vacancyProblems(f: VacancyForm, today: string): ('title' | 'directions' | 'region' | 'seats' | 'deadline')[] {
  const out: ('title' | 'directions' | 'region' | 'seats' | 'deadline')[] = []
  if (f.title.trim().length < 2) out.push('title')
  if (f.directions.length < 1 || f.directions.length > 10) out.push('directions')
  if (!f.region) out.push('region')
  if (!/^\d+$/.test(f.seats.trim()) || Number(f.seats) < 1 || Number(f.seats) > 1000) out.push('seats')
  if (f.deadline && f.deadline < today) out.push('deadline')
  return out
}

/** Today in Tashkent (UTC+5), as the API counts the deadline. */
export const tashkentToday = (now = new Date()) => new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10)

// ───────────── Calls ─────────────

export const companyApi = {
  me: () => api<CompanyProfileDto>('/companies/me'),
  update: (patch: Record<string, unknown>) => api<CompanyProfileDto>('/companies/me', { method: 'PATCH', body: patch }),
  submit: () => api<CompanyProfileDto>('/companies/me/submit', { method: 'POST' }),
  /** The certificate: a signed PUT address, the file goes straight to storage, then the key is confirmed. */
  uploadCertificate: async (file: File): Promise<CompanyProfileDto> => {
    const up = await api<DocumentUploadDto>('/companies/me/certificate/upload-url', { method: 'POST', body: { contentType: file.type, fileSize: file.size } })
    const put = await fetch(up.uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type } })
    if (!put.ok) throw new Error(`upload failed: ${put.status}`)
    return api<CompanyProfileDto>('/companies/me/certificate', { method: 'POST', body: { key: up.key } })
  },
  certificateLink: () => api<DocumentLinkDto>('/companies/me/certificate'),

  /** Requests «под обучение» (ТЗ 5.2). */
  requests: () => api<TrainingRequestDto[]>('/companies/me/training-requests'),
  createRequest: (r: { directionId: string; count: number; byYear: number; regionId: string | null; requirements: string }) =>
    api<TrainingRequestDto>('/companies/me/training-requests', { method: 'POST', body: { ...r, requirements: r.requirements.trim() || null } }),
  updateRequest: (reqId: string, r: { count: number; byYear: number; requirements: string }) =>
    api<TrainingRequestDto>(`/companies/me/training-requests/${id(reqId)}`, { method: 'PATCH', body: { ...r, requirements: r.requirements.trim() || null } }),
  closeRequest: (reqId: string) => api<TrainingRequestDto>(`/companies/me/training-requests/${id(reqId)}/close`, { method: 'POST' }),
  acceptOffer: (offerId: string) => api<TrainingRequestDto>(`/companies/me/offers/${id(offerId)}/accept`, { method: 'POST' }),
  declineOffer: (offerId: string) => api<TrainingRequestDto>(`/companies/me/offers/${id(offerId)}/decline`, { method: 'POST' }),

  /** Graduation announcements of the company's industries (ТЗ 5.1). */
  announcements: (year?: number) => api<CompanyAnnouncementDto[]>(`/announcements${qs({ year })}`),
  announcement: (annId: string) => api<CompanyAnnouncementDto>(`/announcements/${id(annId)}`),
  respond: (annId: string, lines: { lineId: string; wantedCount: number }[], comment: string) =>
    api<CompanyAnnouncementDto>(`/announcements/${id(annId)}/responses`, { method: 'POST', body: { lines, comment: comment.trim() || null } }),
  /** «Запросить контакты» of a graduate: the student decides. */
  invite: (studentId: string, announcementId: string) => api<CompanyAnnouncementDto>(`/graduates/${id(studentId)}/invite`, { method: 'POST', body: { announcementId } }),

  vacancies: () => api<CompanyVacancyDto[]>('/companies/me/vacancies'),
  createVacancy: (f: VacancyForm) => api<CompanyVacancyDto>('/companies/me/vacancies', { method: 'POST', body: vacancyBody(f) }),
  updateVacancy: (vacId: string, f: VacancyForm) => api<CompanyVacancyDto>(`/companies/me/vacancies/${id(vacId)}`, { method: 'PATCH', body: vacancyBody(f) }),
  closeVacancy: (vacId: string) => api<CompanyVacancyDto>(`/companies/me/vacancies/${id(vacId)}/close`, { method: 'POST' }),
  applications: (vacId: string) => api<VacancyApplicationDto[]>(`/companies/me/vacancies/${id(vacId)}/applications`),
  setApplication: (appId: string, status: 'INVITED' | 'REJECTED') => api<VacancyApplicationDto[]>(`/companies/me/vacancy-applications/${id(appId)}/status`, { method: 'POST', body: { status } }),
  applicationFile: (appId: string, certId: string) => api<DocumentLinkDto>(`/companies/me/vacancy-applications/${id(appId)}/certificates/${id(certId)}/file`),

  /** Help with the contract fee (ТЗ 5.3): anonymised cards; «Проявить интерес» asks the student for contacts. */
  contractHelp: (region?: string) => api<ContractHelpCardDto[]>(`/contract-help${qs({ region })}`),
  interest: (cardId: string) => api<ContractHelpCardDto>(`/contract-help/${id(cardId)}/interest`, { method: 'POST' }),

  /** «Мои контакты» (ТЗ 4.3): the names; one card at a time, each opening audited. */
  contacts: () => api<CompanyContactDto[]>('/companies/me/contacts'),
  contact: (contactId: string) => api<CompanyContactDto>(`/companies/me/contacts/${id(contactId)}`),
  contactFile: (contactId: string, certId: string) => api<DocumentLinkDto>(`/companies/me/contacts/${id(contactId)}/certificates/${id(certId)}/file`),
  application: (appId: string) => api<VacancyApplicationDto>(`/companies/me/vacancy-applications/${id(appId)}`),
}
