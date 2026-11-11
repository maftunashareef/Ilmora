import type { MetadataRoute } from 'next'
import { isUniversityListed } from '@ilmora/shared'
import { getCatalog, getSite, SITE_URL } from '@/lib/server-api'

const LOCALES = ['uz', 'ru', 'en'] as const
const STATIC = ['', '/courses', '/teachers', '/builder', '/course-finder', '/universities', '/how-it-works', '/centers', '/faq']

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [catalog, site] = await Promise.all([getCatalog().catch(() => null), getSite()])
  // A university has a public page once it is shown on the University Preparation page.
  const universityIds = (site.universities ?? []).filter((u) => isUniversityListed(u, site.presets ?? [])).map((u) => u.id)
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
    // A teacher whose channel is turned off has no public page (404): not in the sitemap (security review №21).
    ...(catalog?.teachers ?? []).filter((t) => t.channelActive).flatMap((t) => entry(`/teachers/${t.slug ?? t.id}`, undefined, 0.6)),
    ...universityIds.flatMap((id) => entry(`/universities/${id}`, undefined, 0.7)),
  ]
}
