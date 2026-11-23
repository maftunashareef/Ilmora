'use client'
import type { ReactNode } from 'react'
import { PublicShell } from '@/components/layout/PublicShell'
import { OutletProvider } from '@/lib/router'

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <OutletProvider outlet={children}>
      <PublicShell />
    </OutletProvider>
  )
}
