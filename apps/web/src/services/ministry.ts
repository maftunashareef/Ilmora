import type {
  InstitutionPassportDto, Lang, L, MinistryCompanyItemDto, MinistryInstitutionItemDto, MinistryStatsDto, MinistryTableKey, PageDto,
  RegistryInstitutionType, RegistryOwnership, StatsTableDto,
} from '@ilmora/shared'
import { api } from '../lib/api'

/** Filters of the figures (ТЗ 7.3); '' — any. The region is its id or slug. */
export interface FiguresFilter { regionId: string; type: RegistryInstitutionType | ''; ownership: RegistryOwnership | ''; year: string }
export const NO_FIGURES_FILTER: FiguresFilter = { regionId: '', type: '', ownership: '', year: '' }

export const INSTITUTION_TYPES: RegistryInstitutionType[] = ['TECHNIKUM', 'COLLEGE', 'LYCEUM', 'SCHOOL', 'UNIVERSITY', 'TRAINING_CENTER']
export const OWNERSHIPS: RegistryOwnership[] = ['STATE', 'PRIVATE']

/** Statuses of the ministry's institution list (`?status=`): free records of the official list, under review, approved, rejected, added by students. */
export const MINISTRY_INSTITUTION_STATUSES = ['approved', 'pending', 'unclaimed', 'rejected', 'student'] as const
export type MinistryInstitutionStatus = (typeof MINISTRY_INSTITUTION_STATUSES)[number]
export const MINISTRY_COMPANY_STATUSES = ['approved', 'pending'] as const
export type MinistryCompanyStatus = (typeof MINISTRY_COMPANY_STATUSES)[number]

export interface InstitutionsFilter {
  q: string; type: RegistryInstitutionType | ''; ownership: RegistryOwnership | ''; regionId: string; industryId: string; status: MinistryInstitutionStatus | ''; page: number
}
export interface CompaniesFilter { q: string; industryId: string; regionId: string; status: MinistryCompanyStatus | ''; page: number }

/** A query string without the empty values; text is trimmed, page 1 is left out. */
export function queryOf(params: Record<string, string | number | null | undefined>): string {
  const pairs = Object.entries(params)
    .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v] as const)
    .filter(([k, v]) => v !== '' && v !== null && v !== undefined && !(k === 'page' && v === 1))
    .map(([k, v]) => [k, String(v)])
  const s = new URLSearchParams(pairs).toString()
  return s ? `?${s}` : ''
}

const figuresParams = (f: FiguresFilter) => ({ regionId: f.regionId, type: f.type, ownership: f.ownership, year: f.year })

/** Years offered in the filter: graduation, training requests and enrolment look a few years ahead. */
export const filterYears = (now = new Date()) => Array.from({ length: 8 }, (_, i) => now.getFullYear() - 3 + i)

/** The Excel file's name, as the API names it: `ilmora-<table>-<date>.xlsx`. */
export const exportFileName = (table: MinistryTableKey, now = new Date()) => `ilmora-${table}-${now.toISOString().slice(0, 10)}.xlsx`

/** The ministry's workspace calls (`/v1/ministry`, PR #27): read-only, counts only — no personal data. */
export const ministry = {
  stats: (f: FiguresFilter) => api<MinistryStatsDto>(`/ministry/stats${queryOf(figuresParams(f))}`),
  /** One table as .xlsx in the chosen language with the same filters; every download is written to the audit log. */
  exportTable: (table: MinistryTableKey, lang: Lang, f: FiguresFilter) =>
    api<Blob>(`/ministry/export${queryOf({ table, lang, ...figuresParams(f) })}`, { responseType: 'blob', headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }),
  institutions: (f: InstitutionsFilter) =>
    api<PageDto<MinistryInstitutionItemDto>>(`/ministry/institutions${queryOf({ q: f.q, type: f.type, ownership: f.ownership, regionId: f.regionId, industryId: f.industryId, status: f.status, page: f.page })}`),
  institution: (id: string) => api<InstitutionPassportDto>(`/ministry/institutions/${encodeURIComponent(id)}`),
  companies: (f: CompaniesFilter) =>
    api<PageDto<MinistryCompanyItemDto>>(`/ministry/companies${queryOf({ q: f.q, industryId: f.industryId, regionId: f.regionId, status: f.status, page: f.page })}`),
}

const isL = (v: unknown): v is L => !!v && typeof v === 'object' && 'ru' in (v as object)

/** 1234567 → «1 234 567»; 42.5 → «42,5» (uz, ru) or «42.5» (en). */
export function formatCount(n: number, lang: Lang): string {
  const [int, frac] = Math.abs(n).toString().split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${n < 0 ? '−' : ''}${grouped}${frac ? (lang === 'en' ? '.' : ',') + frac : ''}`
}

/** A cell of a figures table as text: names in the reader's language, numbers grouped, nothing — a dash. */
export function cellText(v: StatsTableDto['rows'][number][string], lang: Lang): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return formatCount(v, lang)
  if (isL(v)) return v[lang] || v.ru
  return String(v)
}

/** The total of a numeric column (shown under tables with several rows); percentages and years are not summed. */
export function columnTotal(t: StatsTableDto, key: string): number | null {
  if (key === 'coverage' || key === 'year') return null
  let sum = 0
  for (const r of t.rows) { const v = r[key]; if (typeof v === 'number') sum += v }
  return sum
}

/** Hands the browser a file to save (the Excel download). */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
