import type {
  CompanyProfileDto, CompanyReviewDto, CompanyReviewItemDto, DocumentLinkDto, InstitutionPassportDto, InstitutionReviewDto, InstitutionReviewItemDto,
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

/**
 * Super Admin review of institution and company profiles (decision of 10.11: the Super Admin decides, not the ministry).
 * `release` — «Отвязать представителя» (security review №17): the record is freed for the next representative of the
 * same STIR, the previous one is notified; a company starts again as a clean draft.
 */
export const reviews = {
  institutions: {
    queue: () => api<InstitutionReviewItemDto[]>('/admin/institutions/reviews'),
    detail: (i: string) => api<InstitutionReviewDto>(`/admin/institutions/${id(i)}`),
    approve: (i: string) => api<InstitutionPassportDto>(`/admin/institutions/${id(i)}/approve`, { method: 'POST' }),
    reject: (i: string, reason: string) => api<InstitutionPassportDto>(`/admin/institutions/${id(i)}/reject`, { method: 'POST', body: { reason: cleanReason(reason) } }),
    release: (i: string, reason: string) => api<InstitutionPassportDto>(`/admin/institutions/${id(i)}/release`, { method: 'POST', body: { reason: cleanReason(reason) } }),
  },
  companies: {
    queue: () => api<CompanyReviewItemDto[]>('/admin/companies/reviews'),
    detail: (i: string) => api<CompanyReviewDto>(`/admin/companies/${id(i)}`),
    /** A 5-minute link to the state-registration certificate (audited). */
    certificate: (i: string) => api<DocumentLinkDto>(`/admin/companies/${id(i)}/certificate`),
    approve: (i: string) => api<CompanyProfileDto>(`/admin/companies/${id(i)}/approve`, { method: 'POST' }),
    reject: (i: string, reason: string) => api<CompanyProfileDto>(`/admin/companies/${id(i)}/reject`, { method: 'POST', body: { reason: cleanReason(reason) } }),
    release: (i: string, reason: string) => api<CompanyProfileDto>(`/admin/companies/${id(i)}/release`, { method: 'POST', body: { reason: cleanReason(reason) } }),
  },
}
