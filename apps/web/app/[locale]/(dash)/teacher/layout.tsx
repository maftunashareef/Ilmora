'use client'
import type { ReactNode } from 'react'
import { TeacherLayout, OutletProvider, RequireRole } from '@/views/next/clients'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['teacher', 'admin']}>
      <OutletProvider outlet={children}>
        <TeacherLayout />
      </OutletProvider>
    </RequireRole>
  )
}
