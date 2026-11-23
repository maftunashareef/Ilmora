'use client'
import type { ReactNode } from 'react'
import { RequireRole } from '@/components/RequireRole'
import { OutletProvider } from '@/lib/router'
import { MinistryLayout } from '@/views/ministry/MinistryLayout'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['ministry']}>
      <OutletProvider outlet={children}>
        <MinistryLayout />
      </OutletProvider>
    </RequireRole>
  )
}
