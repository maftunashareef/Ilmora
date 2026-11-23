'use client'
import type { ReactNode } from 'react'
import { RequireRole } from '@/components/RequireRole'
import { OutletProvider } from '@/lib/router'
import { InstitutionLayout } from '@/views/institution/InstitutionLayout'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['institution']}>
      <OutletProvider outlet={children}>
        <InstitutionLayout />
      </OutletProvider>
    </RequireRole>
  )
}
