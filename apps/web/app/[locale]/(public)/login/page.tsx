import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { LoginPage } from '@/views/public/Login'

/** The browser tab names the page (М17): «{title} — ILMORA» by the root layout's template. */
export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  return { title: translate(locale, 'auth.signIn'), robots: { index: false, follow: false } }
}

export default function Page() {
  return <LoginPage />
}
