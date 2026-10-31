import { foldForSearch } from './format.js'
import { activePercent } from './pricing.js'
import type { CertificateKind, Course, LearningFormat } from './types.js'

/** Format of a course; courses saved before the field existed are OFFLINE. */
export const courseFormat = (c: Pick<Course, 'learningFormat'>): LearningFormat => (c.learningFormat === 'ONLINE' ? 'ONLINE' : 'OFFLINE')
export const isOnlineCourse = (c: Pick<Course, 'learningFormat'>): boolean => courseFormat(c) === 'ONLINE'

export const LEARNING_FORMATS: readonly LearningFormat[] = ['OFFLINE', 'ONLINE']
/** Slug of the platform center and profile that every ONLINE course belongs to; they are not real centers or teachers. */
export const ONLINE_PROVIDER_SLUG = 'ilmora-online'
export const CERTIFICATE_KINDS: readonly CertificateKind[] = ['NONE', 'FREE', 'PAID', 'AVAILABLE']

/** The catalog's format tabs: everything, offline only, online only. The URL carries them as lowercase words. */
export type FormatFilter = 'ALL' | LearningFormat
export const formatFilterFromParam = (v: string | null | undefined): FormatFilter => (v === 'online' ? 'ONLINE' : v === 'offline' ? 'OFFLINE' : 'ALL')
export const formatFilterToParam = (f: FormatFilter): string => (f === 'ONLINE' ? 'online' : f === 'OFFLINE' ? 'offline' : '')

/** https, a dotted host name (no IP address, no user:password@), an optional port, then any path without spaces. */
const HTTPS_LINK = /^https:\/\/([a-z0-9-]+\.)+[a-z]{2,}(:\d{1,5})?([/?#]\S*)?$/i

/** External learning links are opened in a new tab, so only plain https links to a named host are accepted. */
export const isSafeExternalUrl = (value: string | null | undefined): boolean => !!value && value.length <= 500 && HTTPS_LINK.test(value)

export interface CourseFilters {
  format?: FormatFilter
  categoryId?: string
  centerId?: string
  level?: string
  /** 0 = Monday … 6 = Sunday; only offline courses have scheduled days. */
  day?: number | null
  /** Free-text search, matched against `haystack(course)` ignoring case, accents and Uzbek spelling (see foldForSearch). */
  q?: string
  /** Only courses with a discount active right now ("Barça çegirmalar"); online courses never have one. */
  sale?: boolean
}

/**
 * The catalog filters, all applied together. `haystack` builds the searchable text of a course (title, summary,
 * provider, instructor, category and so on) so the caller decides how it is localised.
 */
export function filterCourses<T extends Pick<Course, 'learningFormat' | 'categoryId' | 'centerId'> & { level: string; groups: { days: number[] }[]; discount?: Course['discount'] }>(
  courses: T[],
  filters: CourseFilters,
  haystack: (course: T) => string,
): T[] {
  const q = foldForSearch((filters.q ?? '').trim())
  const format = filters.format ?? 'ALL'
  return courses.filter((c) => {
    if (format !== 'ALL' && courseFormat(c) !== format) return false
    if (filters.categoryId && c.categoryId !== filters.categoryId) return false
    if (filters.centerId && c.centerId !== filters.centerId) return false
    if (filters.level && c.level !== filters.level) return false
    if (filters.day != null && !c.groups.some((g) => g.days.includes(filters.day as number))) return false
    if (filters.sale && (isOnlineCourse(c) || activePercent(c) === 0)) return false
    if (q && !foldForSearch(haystack(c)).includes(q)) return false
    return true
  })
}

/** How many courses each format tab holds (before the format filter itself is applied). */
export const formatCounts = (courses: Pick<Course, 'learningFormat'>[]): Record<FormatFilter, number> => ({
  ALL: courses.length,
  OFFLINE: courses.filter((c) => courseFormat(c) === 'OFFLINE').length,
  ONLINE: courses.filter((c) => courseFormat(c) === 'ONLINE').length,
})
