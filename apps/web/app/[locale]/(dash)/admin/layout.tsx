'use client'
import type { ReactNode } from 'react'
import { RequireRole } from '@/components/RequireRole'
import { OutletProvider } from '@/lib/router'
import { AdminLayout } from '@/views/admin/AdminLayout'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['admin']}>
      <OutletProvider outlet={children}>
        <AdminLayout />
      </OutletProvider>
    </RequireRole>
  )
}
