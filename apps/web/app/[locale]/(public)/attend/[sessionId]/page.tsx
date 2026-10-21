import type { Metadata } from 'next'
import { AttendPage } from '@/views/next/clients'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function Page() {
  return <AttendPage />
}
