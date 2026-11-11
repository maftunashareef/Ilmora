import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isUniversityListed, translate, universityName, type Lang } from '@ilmora/shared'
import { pageMetadata } from '@/lib/seo'
import { getSite } from '@/lib/server-api'

type Params = Promise<{ locale: Lang; id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, id } = await params
  const site = await getSite()
  // Only universities shown on the University Preparation page have a public page.
  const university = (site.universities ?? []).find((u) => u.id === id && isUniversityListed(u, site.presets ?? []))
  if (!university) notFound()
  return pageMetadata({ locale, path: `/universities/${university.id}`, title: `${universityName(university, locale)} — ${translate(locale, 'uni.page.title')}`, description: translate(locale, 'uni.page.meta') })
}

import { UniversityPage } from '@/views/next/clients'

export default async function Page({ params }: { params: Params }) {
  const { id } = await params
  const site = await getSite()
  // A university not shown on the University Preparation page is a real 404 (М2).
  if (!(site.universities ?? []).some((u) => u.id === id && isUniversityListed(u, site.presets ?? []))) notFound()
  return <UniversityPage />
}
