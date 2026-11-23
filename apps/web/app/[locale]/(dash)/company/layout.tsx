'use client'
import type { ReactNode } from 'react'
import { RequireRole } from '@/components/RequireRole'
import { OutletProvider } from '@/lib/router'
import { CompanyLayout } from '@/views/company/CompanyLayout'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['company']}>
      <OutletProvider outlet={children}>
        <CompanyLayout />
      </OutletProvider>
    </RequireRole>
  )
}
