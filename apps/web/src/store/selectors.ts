'use client'
import { useMemo } from 'react'
import { useStore } from './useStore'
import type { Features, Viewer } from '../types'

/** Who is looking, in access-check terms. Derived from the authenticated account. */
export function useViewer(): Viewer {
  const role = useStore((s) => s.role)
  const teacherId = useStore((s) => s.currentTeacherId)
  const studentId = useStore((s) => s.currentStudentId)
  const student = useStore((s) => s.students.find((x) => x.id === s.currentStudentId))
  const groupIds = student?.subscription.status === 'active' ? student.subscription.groupIds : []
  const key = groupIds.join('|')
  return useMemo<Viewer>(
    () => ({
      role,
      teacherId: role === 'teacher' || role === 'admin' ? teacherId || undefined : undefined,
      studentId: role === 'visitor' ? undefined : studentId || undefined,
      groupIds: key ? key.split('|') : [],
    }),
    [role, teacherId, studentId, key],
  )
}

/** The signed-in person's student record (never falls back to another account). */
export const useCurrentStudent = () => useStore((s) => s.students.find((x) => x.id === s.currentStudentId))
export const useCurrentTeacher = () => useStore((s) => s.teachers.find((x) => x.id === s.currentTeacherId))

export const useCourse = (id: string | undefined) => useStore((s) => s.courses.find((c) => c.id === id || c.slug === id))
export const useTeacher = (id: string | undefined) => useStore((s) => s.teachers.find((t) => t.id === id || t.slug === id))
export const useCenter = (id: string | undefined) => useStore((s) => s.centers.find((c) => c.id === id))
export const useCategory = (id: string | undefined) => useStore((s) => s.categories.find((c) => c.id === id))

export const useFeature = (key: keyof Features) => useStore((s) => s.site.features[key])

export const useModuleEnabled = (dash: 'student' | 'teacher', id: string) =>
  useStore((s) => s.site.dashboards[dash].find((m) => m.id === id)?.enabled ?? true)
