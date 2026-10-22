import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { pageMetadata, staticTitle } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  return pageMetadata({ locale, path: '/oferta', title: staticTitle(locale, '/oferta'), description: translate(locale, 'legal.offerDescription') })
}

import { OfferPage } from '@/views/next/clients'

export default function Page() {
  return <OfferPage />
}
