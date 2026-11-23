'use client'
import type { ReactNode } from 'react'
import { RequireRole } from '@/components/RequireRole'
import { OutletProvider } from '@/lib/router'
import { StudentLayout } from '@/views/student/StudentLayout'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['student', 'admin']}>
      <OutletProvider outlet={children}>
        <StudentLayout />
      </OutletProvider>
    </RequireRole>
  )
}
