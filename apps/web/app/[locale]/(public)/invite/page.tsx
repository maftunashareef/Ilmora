import type { Metadata } from 'next'
import { translate, type Lang } from '@ilmora/shared'
import { InvitePage } from '@/views/next/clients'

/** A center's invitation (the token is in the fragment, read by the page): never indexed. */
export async function generateMetadata({ params }: { params: Promise<{ locale: Lang }> }): Promise<Metadata> {
  const { locale } = await params
  return { title: translate(locale, 'invite.title'), robots: { index: false, follow: false } }
}

export default function Page() {
  return <InvitePage />
}
