'use client'
import type { ReactNode } from 'react'
import { InstitutionLayout, OutletProvider, RequireRole } from '@/views/next/clients'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['institution']}>
      <OutletProvider outlet={children}>
        <InstitutionLayout />
      </OutletProvider>
    </RequireRole>
  )
}
