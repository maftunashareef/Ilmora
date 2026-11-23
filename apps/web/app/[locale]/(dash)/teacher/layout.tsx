'use client'
import type { ReactNode } from 'react'
import { RequireRole } from '@/components/RequireRole'
import { OutletProvider } from '@/lib/router'
import { TeacherLayout } from '@/views/teacher/TeacherLayout'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={['teacher', 'admin']}>
      <OutletProvider outlet={children}>
        <TeacherLayout />
      </OutletProvider>
    </RequireRole>
  )
}
