'use client'
import type { ReactNode } from 'react'
import { StudentLayout, OutletProvider, RequireRole } from '@/views/next/clients'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['student', 'admin']}>
      <OutletProvider outlet={children}>
        <StudentLayout />
      </OutletProvider>
    </RequireRole>
  )
}
