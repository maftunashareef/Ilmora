import type {
  AdminCompanyItemDto, AdminInstitutionItemDto, AdminPage, CompanyProfileDto, CompanyReviewDto, CompanyReviewItemDto, DocumentLinkDto, InstitutionPassportDto,
  InstitutionReviewDto, InstitutionReviewItemDto, RegistryInstitutionStatus,
} from '@ilmora/shared'
import { api } from '../lib/api'

/** The API's rule for a reason (reject, release): 5–1000 characters, no < or >; the reason is shown to the representative. */
export const REASON_MIN = 5
export const REASON_MAX = 1000
export const cleanReason = (s: string) => s.normalize('NFC').trim()
export const reasonOk = (s: string) => { const r = cleanReason(s); return r.length >= REASON_MIN && r.length <= REASON_MAX && !/[<>]/.test(r) }

/** The official name differs from the one the representative entered (case and spaces aside). */
export const nameDiffers = (entered: string, official: string | null) =>
  !!official && official.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() !== entered.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

const id = (s: string) => encodeURIComponent(s)

/** What the Super Admin typed in «Все записи»: 9 digits are a STIR (exact), anything else a name. */
export interface RecordSearch { text: string; status: RegistryInstitutionStatus | ''; page: number }
export const STIR_RE = /^\d{9}$/
/** The query string of GET /admin/institutions|companies (issue #50): `stir` or `q`, `status`, `page`. */
export function searchQuery({ text, status, page }: RecordSearch): string {
  const t = text.trim()
  const digits = t.replace(/\s/g, '')
  const qs = new URLSearchParams()
  if (STIR_RE.test(digits)) qs.set('stir', digits)
  else if (t) qs.set('q', t)
  if (status) qs.set('status', status)
  if (page > 1) qs.set('page', String(page))
  const s = qs.toString()
  return s ? `?${s}` : ''
}

/**
 * Super Admin review of institution and company profiles (decision of 10.11: the Super Admin decides, not the ministry).
 * `release` — «Отвязать представителя» (security review №17): the record is freed for the next representative of the
 * same STIR, the previous one is notified; a company starts again as a clean draft.
 */
export const reviews = {
  institutions: {
    queue: () => api<InstitutionReviewItemDto[]>('/admin/institutions/reviews'),
    /** Any status (without one — every record with a representative), 50 per page. */
    search: (s: RecordSearch) => api<AdminPage<AdminInstitutionItemDto>>(`/admin/institutions${searchQuery(s)}`),
    detail: (i: string) => api<InstitutionReviewDto>(`/admin/institutions/${id(i)}`),
    approve: (i: string) => api<InstitutionPassportDto>(`/admin/institutions/${id(i)}/approve`, { method: 'POST' }),
    reject: (i: string, reason: string) => api<InstitutionPassportDto>(`/admin/institutions/${id(i)}/reject`, { method: 'POST', body: { reason: cleanReason(reason) } }),
    release: (i: string, reason: string) => api<InstitutionPassportDto>(`/admin/institutions/${id(i)}/release`, { method: 'POST', body: { reason: cleanReason(reason) } }),
  },
  companies: {
    queue: () => api<CompanyReviewItemDto[]>('/admin/companies/reviews'),
    /** Companies have no UNCLAIMED status; the page sends it only for institutions. */
    search: (s: RecordSearch) => api<AdminPage<AdminCompanyItemDto>>(`/admin/companies${searchQuery(s)}`),
    detail: (i: string) => api<CompanyReviewDto>(`/admin/companies/${id(i)}`),
    /** A 5-minute link to the state-registration certificate (audited). */
    certificate: (i: string) => api<DocumentLinkDto>(`/admin/companies/${id(i)}/certificate`),
    approve: (i: string) => api<CompanyProfileDto>(`/admin/companies/${id(i)}/approve`, { method: 'POST' }),
    reject: (i: string, reason: string) => api<CompanyProfileDto>(`/admin/companies/${id(i)}/reject`, { method: 'POST', body: { reason: cleanReason(reason) } }),
    release: (i: string, reason: string) => api<CompanyProfileDto>(`/admin/companies/${id(i)}/release`, { method: 'POST', body: { reason: cleanReason(reason) } }),
  },
}
