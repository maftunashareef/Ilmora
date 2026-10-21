import type { MetadataRoute } from 'next'
import { getCatalog, SITE_URL } from '@/lib/server-api'

const LOCALES = ['uz', 'ru', 'en'] as const
const STATIC = ['', '/courses', '/teachers', '/builder', '/how-it-works', '/centers', '/faq']

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await getCatalog().catch(() => null)
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
  ]
}
