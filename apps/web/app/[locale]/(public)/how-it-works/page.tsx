import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { pageMetadata, staticTitle } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  return pageMetadata({ locale, path: '/how-it-works', title: staticTitle(locale, '/how-it-works'), description: translate(locale, 'home.demoBanner') })
}

import { TemplatePage } from '@/views/next/clients'

export default function Page() {
  return <TemplatePage page="howItWorks" />
}
