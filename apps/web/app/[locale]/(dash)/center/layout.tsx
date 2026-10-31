'use client'
import type { ReactNode } from 'react'
import { CenterLayout, OutletProvider, RequireRole } from '@/views/next/clients'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['center']}>
      <OutletProvider outlet={children}>
        <CenterLayout />
      </OutletProvider>
    </RequireRole>
  )
}
