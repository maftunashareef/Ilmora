'use client'
import { useMemo, useSyncExternalStore } from 'react'
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

/** Visitors and students may save courses, subject to the Super Admin switches (`savedItems`, student `saveItems`). */
export function useCanSaveCourses(): boolean {
  const role = useStore((s) => s.role)
  const savedItems = useStore((s) => s.site.features.savedItems)
  const saveItems = useStore((s) => s.site.permissions.student.saveItems)
  return savedItems && (role === 'visitor' || (role === 'student' && saveItems))
}

/** False on the server and during the first client render, so values read from localStorage never cause a hydration mismatch. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false)
}
const subscribeNever = () => () => undefined

export const useModuleEnabled = (dash: 'student' | 'teacher', id: string) =>
  useStore((s) => s.site.dashboards[dash].find((m) => m.id === id)?.enabled ?? true)
