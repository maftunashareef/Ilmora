import type { Metadata } from 'next'
import { PlaylistPage } from '@/views/next/clients'

export const metadata: Metadata = { robots: { index: false, follow: true } }

export default function Page() {
  return <PlaylistPage />
}
