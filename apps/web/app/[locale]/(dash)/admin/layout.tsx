'use client'
import type { ReactNode } from 'react'
import { AdminLayout, OutletProvider, RequireRole } from '@/views/next/clients'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['admin']}>
      <OutletProvider outlet={children}>
        <AdminLayout />
      </OutletProvider>
    </RequireRole>
  )
}
