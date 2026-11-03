import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { pageMetadata } from '@/lib/seo'
import { getSite } from '@/lib/server-api'

type Params = Promise<{ locale: Lang; id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, id } = await params
  const site = await getSite()
  // Only universities with a published package have a public page.
  const published = (site.presets ?? []).some((p) => p.enabled && p.universityId === id)
  const university = published ? (site.universities ?? []).find((u) => u.id === id) : undefined
  if (!university) return { title: 'ILMORA', robots: { index: false } }
  return pageMetadata({ locale, path: `/universities/${university.id}`, title: `${university.name} — ${translate(locale, 'uni.page.title')}`, description: translate(locale, 'uni.page.meta') })
}

import { UniversityPage } from '@/views/next/clients'

export default function Page() {
  return <UniversityPage />
}
