import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { pageMetadata, staticTitle } from '@/lib/seo'

export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  // Personal list (kept on the device or the account): not for search engines.
  return pageMetadata({ locale, path: '/favorites', title: staticTitle(locale, '/favorites'), description: translate(locale, 'favorites.subtitle'), noindex: true })
}

import { FavoritesPage } from '@/views/public/Favorites'

export default function Page() {
  return <FavoritesPage />
}
