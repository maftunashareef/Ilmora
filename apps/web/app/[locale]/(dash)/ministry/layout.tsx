'use client'
import type { ReactNode } from 'react'
import { MinistryLayout, OutletProvider, RequireRole } from '@/views/next/clients'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['ministry']}>
      <OutletProvider outlet={children}>
        <MinistryLayout />
      </OutletProvider>
    </RequireRole>
  )
}
