import type { Metadata } from 'next'
import { pick, type Lang } from '@ilmora/shared'
import { CenterPage } from '@/views/next/clients'
import { pageMetadata } from '@/lib/seo'
import { getCatalog } from '@/lib/server-api'

type Params = Promise<{ locale: Lang; id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, id } = await params
  const catalog = await getCatalog().catch(() => null)
  const center = catalog?.centers.find((c) => c.slug === id || c.id === id)
  if (!center) return { title: 'ILMORA', robots: { index: false } }
  return pageMetadata({ locale, path: `/centers/${center.slug ?? center.id}`, title: `${center.name} — ${pick(locale, center.district)}`, description: pick(locale, center.description), type: 'article' })
}

export default function Page() {
  return <CenterPage />
}
