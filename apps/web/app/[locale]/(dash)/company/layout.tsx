'use client'
import type { ReactNode } from 'react'
import { CompanyLayout, OutletProvider, RequireRole } from '@/views/next/clients'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['company']}>
      <OutletProvider outlet={children}>
        <CompanyLayout />
      </OutletProvider>
    </RequireRole>
  )
}
