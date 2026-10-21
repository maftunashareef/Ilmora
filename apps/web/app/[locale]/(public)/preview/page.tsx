import type { Metadata } from 'next'
import { PreviewPage } from '@/views/next/clients'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function Page() {
  return <PreviewPage />
}
