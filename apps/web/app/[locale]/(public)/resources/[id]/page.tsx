import type { Metadata } from 'next'
import { pick, translate, type Lang } from '@ilmora/shared'
import { getContentTitle } from '@/lib/server-api'
import { ResourcePage } from '@/views/next/clients'

/** The tab shows the item's own title when it is public, else what kind of page it is (М17). */
export async function generateMetadata({ params }: { params: Promise<{ locale: Lang; id: string }> }): Promise<Metadata> {
  const { locale, id } = await params
  const title = await getContentTitle('resources', id)
  return { title: (title && pick(locale, title)) || translate(locale, 'common.resource'), robots: { index: false, follow: true } }
}

export default function Page() {
  return <ResourcePage />
}
