import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { CenterAttendPage } from '@/views/public/CenterAttend'

/** The browser tab names the page (М17): «{title} — ILMORA» by the root layout's template. */
export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  return { title: translate(locale, 'attend.center.title'), robots: { index: false, follow: false } }
}

export default function Page() {
  return <CenterAttendPage />
}
