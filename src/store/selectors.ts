import { useMemo } from 'react'
import { useStore } from './useStore'
import type { Features, Viewer } from '../types'

/** Who is looking, in access-check terms. Derived from the demo role switcher. */
export function useViewer(): Viewer {
  const role = useStore((s) => s.role)
  const teacherId = useStore((s) => s.currentTeacherId)
  const studentId = useStore((s) => s.currentStudentId)
  const student = useStore((s) => s.students.find((x) => x.id === s.currentStudentId))
  const groupIds = student?.subscription.status === 'active' ? student.subscription.groupIds : []
  return useMemo<Viewer>(
    () => ({
      role,
      teacherId: role === 'teacher' ? teacherId : undefined,
      studentId: role === 'student' ? studentId : undefined,
      groupIds: role === 'student' ? groupIds : [],
    }),
    [role, teacherId, studentId, groupIds.join('|')], // eslint-disable-line react-hooks/exhaustive-deps
  )
}

export const useCurrentStudent = () => useStore((s) => s.students.find((x) => x.id === s.currentStudentId) ?? s.students[0])
export const useCurrentTeacher = () => useStore((s) => s.teachers.find((x) => x.id === s.currentTeacherId) ?? s.teachers[0])

export const useCourse = (id: string | undefined) => useStore((s) => s.courses.find((c) => c.id === id))
export const useTeacher = (id: string | undefined) => useStore((s) => s.teachers.find((t) => t.id === id))
export const useCenter = (id: string | undefined) => useStore((s) => s.centers.find((c) => c.id === id))
export const useCategory = (id: string | undefined) => useStore((s) => s.categories.find((c) => c.id === id))

export const useFeature = (key: keyof Features) => useStore((s) => s.site.features[key])

export const useModuleEnabled = (dash: 'student' | 'teacher', id: string) =>
  useStore((s) => s.site.dashboards[dash].find((m) => m.id === id)?.enabled ?? true)
