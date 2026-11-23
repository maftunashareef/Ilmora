import 'server-only'
import { sampleData, type L } from '@ilmora/shared'
import type { Category, Center, Course, SiteConfig, Subject, Teacher } from '../types'
import { api, isApiError } from './api'

export type Catalog = { centers: Center[]; categories: Category[]; teachers: Teacher[]; subjects: Subject[]; courses: Course[] }
/** `GET /public/site`: the site template without the role-permission matrix (Ж17); signed-in accounts read their own. */
export type SiteData = Omit<SiteConfig, 'permissions'> & { version: number }

const { permissions: _samplePermissions, ...sampleSite } = sampleData.site as unknown as SiteConfig
void _samplePermissions
const fallbackSite: SiteData = {
  ...sampleSite,
  version: 1,
}

const fallbackCatalog: Catalog = {
  centers: sampleData.centers as unknown as Center[],
  categories: sampleData.categories as unknown as Category[],
  teachers: sampleData.teachers as unknown as Teacher[],
  subjects: sampleData.subjects as unknown as Subject[],
  courses: sampleData.courses as unknown as Course[],
}

/** Public site template, cached for a minute (admins' edits show up on the next revalidation). */
export const getSite = () =>
  api<SiteData>('/public/site', { auth: false, next: { revalidate: 60, tags: ['site'] } }).catch(() => fallbackSite)

/** Demo content stands in only while developing without an API; the live site never mixes it with real data. */
const DEMO_FALLBACK = process.env.NODE_ENV !== 'production'
const emptyCatalog: Catalog = { centers: [], categories: [], teachers: [], subjects: [], courses: [] }

const fetchCatalog = () =>
  api<Catalog>('/public/catalog', { auth: false, next: { revalidate: 60, tags: ['catalog'] } })
    .then((catalog) => (catalog ? { centers: catalog.centers ?? [], categories: catalog.categories ?? [], teachers: catalog.teachers ?? [], subjects: catalog.subjects ?? [], courses: catalog.courses ?? [] } : DEMO_FALLBACK ? fallbackCatalog : emptyCatalog))

/** Public catalog (published + public items only), cached for a minute; empty when the API cannot be reached. */
export const getCatalog = () => fetchCatalog().catch(() => (DEMO_FALLBACK ? fallbackCatalog : emptyCatalog))

/**
 * The catalog for a detail page (a center): an unreachable API is an error, not «not found» — the page fails rather
 * than answering 404 for every center while the API is down (М2).
 */
export const getCatalogOrThrow = () => fetchCatalog().catch((err: unknown) => { if (DEMO_FALLBACK) return fallbackCatalog; throw err })

/**
 * «Not found» only when the API says so: 404 (no such item) or 403 (a draft, hidden or private one — not for a visitor);
 * any other failure is an error, so an unreachable API never turns every page into 404.
 */
const notFoundOr = <T,>(demo: () => T | null) => (err: unknown): T | null => {
  if (isApiError(err) && (err.status === 404 || err.status === 403)) return null
  if (DEMO_FALLBACK) return demo()
  throw err
}

export const getCourse = (key: string) =>
  api<Course>(`/public/courses/${encodeURIComponent(key)}`, { auth: false, next: { revalidate: 60, tags: ['catalog'] } }).catch(
    notFoundOr(() => (sampleData.courses.find((c) => c.id === key || c.slug === key) as unknown as Course) ?? null),
  )

export const getTeacher = (key: string) =>
  api<{ teacher: Teacher; courses: Course[] }>(`/public/teachers/${encodeURIComponent(key)}`, { auth: false, next: { revalidate: 60, tags: ['catalog'] } }).catch(
    notFoundOr(() => {
      const teacher = sampleData.teachers.find((t) => t.id === key || t.slug === key) as unknown as Teacher | undefined
      if (!teacher) return null
      return { teacher, courses: (sampleData.courses.filter((c) => c.teacherId === teacher.id) as unknown as Course[]) ?? [] }
    }),
  )

/** The title of a public video, playlist or resource for the browser tab; null for a private or missing one (М17). */
export const getContentTitle = (kind: 'videos' | 'playlists' | 'resources', id: string) =>
  api<{ title?: L } | null>(`/public/${kind}/${encodeURIComponent(id)}`, { auth: false, next: { revalidate: 60, tags: ['content'] } })
    .then((r) => r?.title ?? null)
    .catch(() => null)

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

