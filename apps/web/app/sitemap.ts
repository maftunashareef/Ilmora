import type { MetadataRoute } from 'next'
import { getCatalog, getSite, SITE_URL } from '@/lib/server-api'

const LOCALES = ['uz', 'ru', 'en'] as const
const STATIC = ['', '/courses', '/teachers', '/builder', '/course-finder', '/universities', '/how-it-works', '/centers', '/faq']

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [catalog, site] = await Promise.all([getCatalog().catch(() => null), getSite()])
  // A university has a public page once one of its packages is published.
  const universityIds = [...new Set((site.presets ?? []).filter((p) => p.enabled && p.universityId).map((p) => p.universityId as string))]
  const entry = (path: string, lastModified?: string | Date, priority = 0.6): MetadataRoute.Sitemap =>
    LOCALES.map((l) => ({
      url: `${SITE_URL}/${l}${path}`,
      lastModified,
      priority,
      alternates: { languages: Object.fromEntries(LOCALES.map((x) => [x, `${SITE_URL}/${x}${path}`])) },
    }))
  return [
    ...STATIC.flatMap((p) => entry(p, undefined, p === '' ? 1 : 0.8)),
    ...(catalog?.courses ?? []).flatMap((c) => entry(`/courses/${c.slug ?? c.id}`, c.updatedAt, 0.7)),
    ...(catalog?.teachers ?? []).flatMap((t) => entry(`/teachers/${t.slug ?? t.id}`, undefined, 0.6)),
    ...universityIds.flatMap((id) => entry(`/universities/${id}`, undefined, 0.7)),
  ]
}
