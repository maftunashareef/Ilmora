'use client'
import type { ReactNode } from 'react'
import { OutletProvider, PublicShell } from '@/views/next/clients'

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <OutletProvider outlet={children}>
      <PublicShell />
    </OutletProvider>
  )
}
