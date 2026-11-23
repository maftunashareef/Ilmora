import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { pageMetadata, staticTitle } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  return pageMetadata({ locale, path: '/centers', title: staticTitle(locale, '/centers'), description: translate(locale, 'meta.description') })
}

import { TemplatePage } from '@/views/public/TemplatePages'

export default function Page() {
  return <TemplatePage page="centers" />
}
