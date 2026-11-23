import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { pageMetadata, staticTitle } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  return pageMetadata({ locale, path: '/universities', title: staticTitle(locale, '/universities'), description: translate(locale, 'uni.page.meta') })
}

import { UniversitiesPage } from '@/views/public/Universities'

export default function Page() {
  return <UniversitiesPage />
}
