import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { pageMetadata, staticTitle } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  return pageMetadata({ locale, path: '/faq', title: staticTitle(locale, '/faq'), description: translate(locale, 'meta.description') })
}

import { FaqPage } from '@/views/public/Faq'

export default function Page() {
  return <FaqPage  />
}
