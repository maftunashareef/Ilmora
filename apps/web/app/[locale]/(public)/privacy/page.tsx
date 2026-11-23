import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { pageMetadata, staticTitle } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  return pageMetadata({ locale, path: '/privacy', title: staticTitle(locale, '/privacy'), description: translate(locale, 'legal.privacyIntro') })
}

import { PrivacyPage } from '@/views/public/Legal'

export default function Page() {
  return <PrivacyPage />
}
