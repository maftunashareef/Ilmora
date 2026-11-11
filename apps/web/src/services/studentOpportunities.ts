import {
  CONTRACT_HELP_MOTIVATION_MAX, CONTRACT_HELP_YEARS_MAX,
  type ContractHelpDto, type StudentApplicationDto, type StudentContactRequestDto, type StudentQuestionnaire, type VacancyDto, type VacancyKind, type WorkFormat,
} from '@ilmora/shared'
import type { TKey } from '../i18n/translations'
import { api } from '../lib/api'

/**
 * The student's side of the registry (ТЗ 5.3, 5.4, 8): help with the contract fee, vacancies and requests from
 * companies. API: `/students/me/contract-help`, `/vacancies`, `/students/me/applications`, `/students/me/contact-requests`.
 */

// ── help with the contract fee ──
export interface ContractHelpForm { motivation: string; yearsToWork: string; workRegion: 'OWN' | 'ANY'; consent: boolean }
export const emptyContractHelp = (): ContractHelpForm => ({ motivation: '', yearsToWork: '', workRegion: 'OWN', consent: false })
export const CONTRACT_HELP_MOTIVATION_MIN = 10

export type ContractHelpProblem = 'motivation' | 'years' | 'consent'
/** What the form still lacks, by the API's own rules (contract-help.schemas.ts). */
export function contractHelpProblems(f: ContractHelpForm): ContractHelpProblem[] {
  const out: ContractHelpProblem[] = []
  const m = f.motivation.trim().length
  if (m < CONTRACT_HELP_MOTIVATION_MIN || m > CONTRACT_HELP_MOTIVATION_MAX || /[<>]/.test(f.motivation)) out.push('motivation')
  const y = Number(f.yearsToWork)
  if (!Number.isInteger(y) || y < 1 || y > CONTRACT_HELP_YEARS_MAX) out.push('years')
  if (!f.consent) out.push('consent')
  return out
}
export const contractHelpBody = (f: ContractHelpForm) => ({ motivation: f.motivation.trim(), yearsToWork: Number(f.yearsToWork), workRegion: f.workRegion, consent: true as const })
/** The request is still in the companies' feed (one open request per student). */
export const contractHelpOpen = (r: ContractHelpDto | null | undefined) => !!r && (r.status === 'ACTIVE' || r.status === 'INTERESTED')
/** `contract_help_profile` → `details.missing`: what the questionnaire still needs, in words. */
export const CONTRACT_HELP_MISSING: Record<string, TKey> = {
  institution: 'st.h.missing.institution', direction: 'st.h.missing.direction', studyForm: 'st.h.missing.studyForm', contractSum: 'st.h.missing.contractSum',
}

// ── vacancies ──
export interface VacancyFilters { industry: string; region: string; kind: '' | VacancyKind; format: '' | WorkFormat }
/** By default the student's own industry (of the direction in the questionnaire) and region (ТЗ 5.4); the filters can be changed. */
export const defaultVacancyFilters = (q: StudentQuestionnaire | null | undefined): VacancyFilters => ({ industry: q?.direction?.industryId ?? '', region: q?.region ?? '', kind: '', format: '' })
export function vacancyQuery(f: VacancyFilters): string {
  const p = new URLSearchParams()
  for (const k of ['industry', 'region', 'kind', 'format'] as const) if (f[k]) p.set(k, f[k])
  const s = p.toString()
  return s ? `?${s}` : ''
}
export const APPLICATION_NOTE_MAX = 1000

const id = (s: string) => encodeURIComponent(s)
export const studentApi = {
  // An empty answer means no request yet.
  contractHelp: async () => (await api<ContractHelpDto | null>('/students/me/contract-help')) ?? null,
  askContractHelp: (f: ContractHelpForm) => api<ContractHelpDto>('/students/me/contract-help', { method: 'POST', body: contractHelpBody(f) }),
  withdrawContractHelp: () => api<ContractHelpDto>('/students/me/contract-help', { method: 'DELETE' }),
  signed: (companyId: string) => api<ContractHelpDto>('/students/me/contract-help/signed', { method: 'POST', body: { companyId } }),

  vacancies: (f: VacancyFilters) => api<VacancyDto[]>(`/vacancies${vacancyQuery(f)}`),
  apply: (vacancyId: string, note: string) => api<VacancyDto>(`/vacancies/${id(vacancyId)}/apply`, { method: 'POST', body: { note: note.trim() || null, consent: true } }),
  applications: () => api<StudentApplicationDto[]>('/students/me/applications'),
  withdrawApplication: (applicationId: string) => api<StudentApplicationDto[]>(`/students/me/applications/${id(applicationId)}`, { method: 'DELETE' }),

  contactRequests: () => api<StudentContactRequestDto[]>('/students/me/contact-requests'),
  acceptRequest: (requestId: string) => api<StudentContactRequestDto[]>(`/students/me/contact-requests/${id(requestId)}/accept`, { method: 'POST' }),
  declineRequest: (requestId: string) => api<StudentContactRequestDto[]>(`/students/me/contact-requests/${id(requestId)}/decline`, { method: 'POST' }),
  revokeRequest: (requestId: string) => api<StudentContactRequestDto[]>(`/students/me/contact-requests/${id(requestId)}/revoke`, { method: 'POST' }),
}
