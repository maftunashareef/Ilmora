import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pick, type Lang } from '@ilmora/shared'
import { CenterPage } from '@/views/next/clients'
import { pageMetadata } from '@/lib/seo'
import { getCatalogOrThrow } from '@/lib/server-api'

type Params = Promise<{ locale: Lang; id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, id } = await params
  const center = (await getCatalogOrThrow()).centers.find((c) => c.slug === id || c.id === id)
  if (!center) notFound()
  return pageMetadata({ locale, path: `/centers/${center.slug ?? center.id}`, title: `${center.name} — ${pick(locale, center.district)}`, description: pick(locale, center.description), type: 'article' })
}

export default async function Page({ params }: { params: Params }) {
  const { id } = await params
  // A hidden or deleted center is a real 404 for everyone (М2).
  if (!(await getCatalogOrThrow()).centers.some((c) => c.slug === id || c.id === id)) notFound()
  return <CenterPage />
}
