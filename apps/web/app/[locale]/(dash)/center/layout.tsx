'use client'
import type { ReactNode } from 'react'
import { RequireRole } from '@/components/RequireRole'
import { OutletProvider } from '@/lib/router'
import { CenterLayout } from '@/views/center/CenterLayout'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['center']}>
      <OutletProvider outlet={children}>
        <CenterLayout />
      </OutletProvider>
    </RequireRole>
  )
}
