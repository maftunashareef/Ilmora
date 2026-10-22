import { redirect } from 'next/navigation'
import type { Lang } from '@ilmora/shared'

/** The public offer is the agreement users accept; /terms simply points at it. */
export default async function Page({ params }: { params: Promise<{ locale: Lang }> }) {
  const { locale } = await params
  redirect(`/${locale}/oferta`)
}
