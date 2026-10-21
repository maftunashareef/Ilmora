import 'server-only'
import type { Category, Center, Course, SiteConfig, Subject, Teacher } from '../types'
import { api } from './api'

export type Catalog = { centers: Center[]; categories: Category[]; teachers: Teacher[]; subjects: Subject[]; courses: Course[] }
export type SiteData = SiteConfig & { version: number }

/** Public site template, cached for a minute (admins' edits show up on the next revalidation). */
export const getSite = () => api<SiteData>('/public/site', { auth: false, next: { revalidate: 60, tags: ['site'] } })

/** Public catalog (published + public items only), cached for a minute. */
export const getCatalog = () => api<Catalog>('/public/catalog', { auth: false, next: { revalidate: 60, tags: ['catalog'] } })

export const getCourse = (key: string) => api<Course>(`/public/courses/${encodeURIComponent(key)}`, { auth: false, next: { revalidate: 60, tags: ['catalog'] } }).catch(() => null)

export const getTeacher = (key: string) =>
  api<{ teacher: Teacher; courses: Course[] }>(`/public/teachers/${encodeURIComponent(key)}`, { auth: false, next: { revalidate: 60, tags: ['catalog'] } }).catch(() => null)

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
