import 'server-only'
import { sampleData } from '@ilmora/shared'
import type { Category, Center, Course, SiteConfig, Subject, Teacher } from '../types'
import { api } from './api'

export type Catalog = { centers: Center[]; categories: Category[]; teachers: Teacher[]; subjects: Subject[]; courses: Course[] }
export type SiteData = SiteConfig & { version: number }

const fallbackSite: SiteData = {
  ...(sampleData.site as unknown as SiteConfig),
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

/** Public catalog (published + public items only), cached for a minute. */
export const getCatalog = () =>
  api<Catalog>('/public/catalog', { auth: false, next: { revalidate: 60, tags: ['catalog'] } })
    .then((catalog) => (catalog ? { centers: catalog.centers ?? [], categories: catalog.categories ?? [], teachers: catalog.teachers ?? [], subjects: catalog.subjects ?? [], courses: catalog.courses ?? [] } : DEMO_FALLBACK ? fallbackCatalog : emptyCatalog))
    .catch(() => (DEMO_FALLBACK ? fallbackCatalog : emptyCatalog))

export const getCourse = (key: string) =>
  api<Course>(`/public/courses/${encodeURIComponent(key)}`, { auth: false, next: { revalidate: 60, tags: ['catalog'] } }).catch(
    () => (DEMO_FALLBACK ? ((sampleData.courses.find((c) => c.id === key || c.slug === key) as unknown as Course) ?? null) : null),
  )

export const getTeacher = (key: string) =>
  api<{ teacher: Teacher; courses: Course[] }>(`/public/teachers/${encodeURIComponent(key)}`, { auth: false, next: { revalidate: 60, tags: ['catalog'] } }).catch(() => {
    const teacher = DEMO_FALLBACK ? (sampleData.teachers.find((t) => t.id === key || t.slug === key) as unknown as Teacher | undefined) : undefined
    if (!teacher) return null
    const courses = (sampleData.courses.filter((c) => c.teacherId === teacher.id) as unknown as Course[]) ?? []
    return { teacher, courses }
  })

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

