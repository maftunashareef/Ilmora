import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { createSeed } from '../data/seed'
import type {
  Category, Center, Course, DemoState, Lang, Playlist, Publishable, Resource, Role, Section, SectionType,
  SiteConfig, Student, StudentProfile, Subject, Teacher, Video,
} from '../types'
import { emptyL } from '../i18n/useT'

export type PageKey = keyof SiteConfig['pages']
export type ContentKind = 'course' | 'video' | 'playlist' | 'resource'

export interface Toast { id: number; text: string; tone?: 'ok' | 'warn' }

export type BuilderResult =
  | { ok: true }
  | { ok: false; reason: 'no-package' | 'limit' | 'duplicate' | 'conflict' | 'disabled'; conflictWith?: string }

interface Actions {
  // UI
  setLang: (lang: Lang) => void
  setRole: (role: Role) => void
  setCurrentTeacher: (id: string) => void
  setCurrentStudent: (id: string) => void
  notify: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void

  // Site config (Super Admin)
  patchSite: (fn: (site: SiteConfig) => SiteConfig) => void
  updateSection: (page: PageKey, id: string, patch: Partial<Section>) => void
  moveSection: (page: PageKey, id: string, dir: -1 | 1) => void
  addSection: (page: PageKey, type: SectionType) => void
  removeSection: (page: PageKey, id: string) => void
  restorePageDefaults: (page: PageKey) => void
  restoreThemeDefaults: () => void

  // Entities
  upsertCourse: (c: Course) => void
  removeCourse: (id: string) => void
  upsertVideo: (v: Video) => void
  removeVideo: (id: string) => void
  upsertPlaylist: (p: Playlist) => void
  removePlaylist: (id: string) => void
  upsertResource: (r: Resource) => void
  removeResource: (id: string) => void
  upsertTeacher: (t: Teacher) => void
  removeTeacher: (id: string) => void
  upsertSubject: (s: Subject) => void
  removeSubject: (id: string) => void
  upsertCenter: (c: Center) => void
  removeCenter: (id: string) => boolean
  upsertCategory: (c: Category) => void
  removeCategory: (id: string) => boolean
  upsertStudent: (s: Student) => void
  removeStudent: (id: string) => void
  setPublishable: (kind: ContentKind, id: string, patch: Partial<Publishable>) => void

  // Student
  setBuilderPackage: (studentId: string, packageId: string | null) => void
  addBuilderGroup: (studentId: string, groupId: string) => BuilderResult
  removeBuilderCourse: (studentId: string, courseId: string) => void
  activateSubscription: (studentId: string) => boolean
  renewSubscription: (studentId: string) => void
  cancelSubscription: (studentId: string) => void
  toggleSavedCourse: (studentId: string, courseId: string) => void
  toggleSavedTeacher: (studentId: string, teacherId: string) => void
  updateProfile: (studentId: string, patch: Partial<StudentProfile>) => void

  resetDemo: () => void
}

export interface StoreState extends DemoState, Actions {
  lang: Lang
  role: Role
  currentTeacherId: string
  currentStudentId: string
  toasts: Toast[]
}

const upsert = <T extends { id: string }>(list: T[], item: T): T[] =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]

export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

let toastSeq = 1

const seed = createSeed()

const useBoundStore = create<StoreState>()(
  persist(
    (set, get) => ({
      ...seed,
      lang: 'uz',
      role: 'visitor',
      currentTeacherId: 't-bekzod',
      currentStudentId: 's-aziz',
      toasts: [],

      setLang: (lang) => set({ lang }),
      setRole: (role) => set({ role }),
      setCurrentTeacher: (id) => set({ currentTeacherId: id }),
      setCurrentStudent: (id) => set({ currentStudentId: id }),
      notify: (text, tone = 'ok') => {
        const id = toastSeq++
        set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
        setTimeout(() => get().dismissToast(id), 3200)
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      patchSite: (fn) => set((s) => ({ site: fn(s.site) })),
      updateSection: (page, id, patch) =>
        set((s) => ({ site: { ...s.site, pages: { ...s.site.pages, [page]: s.site.pages[page].map((sec) => (sec.id === id ? { ...sec, ...patch } : sec)) } } })),
      moveSection: (page, id, dir) =>
        set((s) => {
          const list = [...s.site.pages[page]]
          const i = list.findIndex((x) => x.id === id)
          const j = i + dir
          if (i < 0 || j < 0 || j >= list.length) return {}
          ;[list[i], list[j]] = [list[j], list[i]]
          return { site: { ...s.site, pages: { ...s.site.pages, [page]: list } } }
        }),
      addSection: (page, type) =>
        set((s) => ({
          site: { ...s.site, pages: { ...s.site.pages, [page]: [...s.site.pages[page], { id: uid('sec'), type, enabled: true, title: emptyL(), subtitle: emptyL(), body: emptyL(), items: [] }] } },
        })),
      removeSection: (page, id) =>
        set((s) => ({ site: { ...s.site, pages: { ...s.site.pages, [page]: s.site.pages[page].filter((x) => x.id !== id) } } })),
      restorePageDefaults: (page) =>
        set((s) => ({ site: { ...s.site, pages: { ...s.site.pages, [page]: createSeed().site.pages[page] } } })),
      restoreThemeDefaults: () => set((s) => ({ site: { ...s.site, theme: createSeed().site.theme } })),

      upsertCourse: (c) => set((s) => ({ courses: upsert(s.courses, c) })),
      removeCourse: (id) => set((s) => ({ courses: s.courses.filter((x) => x.id !== id) })),
      upsertVideo: (v) => set((s) => ({ videos: upsert(s.videos, v) })),
      removeVideo: (id) =>
        set((s) => ({ videos: s.videos.filter((x) => x.id !== id), playlists: s.playlists.map((p) => ({ ...p, videoIds: p.videoIds.filter((v) => v !== id) })) })),
      upsertPlaylist: (p) => set((s) => ({ playlists: upsert(s.playlists, p) })),
      removePlaylist: (id) => set((s) => ({ playlists: s.playlists.filter((x) => x.id !== id) })),
      upsertResource: (r) => set((s) => ({ resources: upsert(s.resources, r) })),
      removeResource: (id) => set((s) => ({ resources: s.resources.filter((x) => x.id !== id) })),
      upsertTeacher: (t) => set((s) => ({ teachers: upsert(s.teachers, t) })),
      removeTeacher: (id) => set((s) => ({ teachers: s.teachers.filter((x) => x.id !== id) })),
      upsertSubject: (sub) => set((s) => ({ subjects: upsert(s.subjects, sub) })),
      removeSubject: (id) =>
        set((s) => ({ subjects: s.subjects.filter((x) => x.id !== id), courses: s.courses.map((c) => (c.subjectId === id ? { ...c, subjectId: undefined } : c)) })),
      upsertCenter: (c) => set((s) => ({ centers: upsert(s.centers, c) })),
      removeCenter: (id) => {
        if (get().courses.some((c) => c.centerId === id) || get().teachers.some((t) => t.centerId === id)) return false
        set((s) => ({ centers: s.centers.filter((x) => x.id !== id) }))
        return true
      },
      upsertCategory: (c) => set((s) => ({ categories: upsert(s.categories, c) })),
      removeCategory: (id) => {
        if (get().courses.some((c) => c.categoryId === id)) return false
        set((s) => ({ categories: s.categories.filter((x) => x.id !== id) }))
        return true
      },
      upsertStudent: (st) => set((s) => ({ students: upsert(s.students, st) })),
      removeStudent: (id) => set((s) => ({ students: s.students.filter((x) => x.id !== id) })),
      setPublishable: (kind, id, patch) =>
        set((s) => {
          const stamp = { ...patch, updatedAt: new Date().toISOString() }
          const map = <T extends Publishable & { id: string }>(list: T[]) => list.map((x) => (x.id === id ? { ...x, ...stamp } : x))
          if (kind === 'course') return { courses: map(s.courses) }
          if (kind === 'video') return { videos: map(s.videos) }
          if (kind === 'playlist') return { playlists: map(s.playlists) }
          return { resources: map(s.resources) }
        }),

      setBuilderPackage: (studentId, packageId) =>
        set((s) => {
          const pkg = s.site.packages.find((p) => p.id === packageId)
          return {
            students: s.students.map((st) => {
              if (st.id !== studentId) return st
              const groupIds = pkg ? st.builder.groupIds.slice(0, pkg.maxCourses) : st.builder.groupIds
              return { ...st, builder: { packageId, groupIds } }
            }),
          }
        }),
      addBuilderGroup: (studentId, groupId) => {
        const s = get()
        const st = s.students.find((x) => x.id === studentId)
        if (!st) return { ok: false, reason: 'no-package' }
        const pkg = s.site.packages.find((p) => p.id === st.builder.packageId)
        if (!pkg) return { ok: false, reason: 'no-package' }
        if (!pkg.enabled) return { ok: false, reason: 'disabled' }
        const allGroups = s.courses.flatMap((c) => c.groups)
        const target = allGroups.find((g) => g.id === groupId)
        if (!target) return { ok: false, reason: 'no-package' }
        const current = st.builder.groupIds.map((id) => allGroups.find((g) => g.id === id)).filter(Boolean) as typeof allGroups
        const sameCourse = current.find((g) => g.courseId === target.courseId)
        // Switching group within the same course is allowed (replace)
        const others = sameCourse ? current.filter((g) => g.courseId !== target.courseId) : current
        if (!sameCourse && others.length >= pkg.maxCourses) return { ok: false, reason: 'limit' }
        const clash = others.find((g) => g.days.some((d) => target.days.includes(d)) && toMin(g.start) < toMin(target.end) && toMin(target.start) < toMin(g.end))
        if (clash) return { ok: false, reason: 'conflict', conflictWith: clash.courseId }
        set((state) => ({
          students: state.students.map((x) => (x.id === studentId ? { ...x, builder: { ...x.builder, groupIds: [...others.map((g) => g.id), groupId] } } : x)),
        }))
        return { ok: true }
      },
      removeBuilderCourse: (studentId, courseId) =>
        set((s) => {
          const allGroups = s.courses.flatMap((c) => c.groups)
          return {
            students: s.students.map((st) =>
              st.id === studentId
                ? { ...st, builder: { ...st.builder, groupIds: st.builder.groupIds.filter((id) => allGroups.find((g) => g.id === id)?.courseId !== courseId) } }
                : st,
            ),
          }
        }),
      activateSubscription: (studentId) => {
        const s = get()
        const st = s.students.find((x) => x.id === studentId)
        const pkg = s.site.packages.find((p) => p.id === st?.builder.packageId)
        if (!st || !pkg || st.builder.groupIds.length !== pkg.maxCourses) return false
        const today = new Date()
        const renew = new Date(today)
        renew.setMonth(renew.getMonth() + 1)
        set((state) => ({
          students: state.students.map((x) =>
            x.id === studentId
              ? { ...x, subscription: { packageId: pkg.id, groupIds: [...st.builder.groupIds], status: 'active', startedAt: today.toISOString().slice(0, 10), renewsAt: renew.toISOString().slice(0, 10) } }
              : x,
          ),
        }))
        return true
      },
      renewSubscription: (studentId) =>
        set((s) => ({
          students: s.students.map((x) => {
            if (x.id !== studentId || x.subscription.status !== 'active') return x
            const base = new Date(x.subscription.renewsAt ?? new Date().toISOString())
            base.setMonth(base.getMonth() + 1)
            return { ...x, subscription: { ...x.subscription, renewsAt: base.toISOString().slice(0, 10) } }
          }),
        })),
      cancelSubscription: (studentId) =>
        set((s) => ({
          students: s.students.map((x) => (x.id === studentId ? { ...x, subscription: { packageId: null, groupIds: [], status: 'none' } } : x)),
        })),
      toggleSavedCourse: (studentId, courseId) =>
        set((s) => ({
          students: s.students.map((x) =>
            x.id === studentId
              ? { ...x, savedCourseIds: x.savedCourseIds.includes(courseId) ? x.savedCourseIds.filter((c) => c !== courseId) : [...x.savedCourseIds, courseId] }
              : x,
          ),
        })),
      toggleSavedTeacher: (studentId, teacherId) =>
        set((s) => ({
          students: s.students.map((x) =>
            x.id === studentId
              ? { ...x, savedTeacherIds: x.savedTeacherIds.includes(teacherId) ? x.savedTeacherIds.filter((c) => c !== teacherId) : [...x.savedTeacherIds, teacherId] }
              : x,
          ),
        })),
      updateProfile: (studentId, patch) =>
        set((s) => ({ students: s.students.map((x) => (x.id === studentId ? { ...x, profile: { ...x.profile, ...patch } } : x)) })),

      resetDemo: () => {
        const fresh = createSeed()
        set({ ...fresh, role: 'visitor', currentTeacherId: 't-bekzod', currentStudentId: 's-aziz' })
      },
    }),
    {
      name: 'ilmora-demo-v1',
      version: 6,
      // Object URLs from local uploads are transient — never persisted.
      storage: createJSONStorage(() => localStorage, { replacer: (key, value) => (key === 'previewUrl' ? undefined : value) }),
      partialize: (s) => {
        const { toasts: _toasts, ...rest } = s
        void _toasts
        return rest as StoreState
      },
      migrate: (persisted, version) => {
        if (version !== 6) return { ...createSeed(), lang: 'uz', role: 'visitor', currentTeacherId: 't-bekzod', currentStudentId: 's-aziz' } as unknown as StoreState
        return persisted as StoreState
      },
    },
  ),
)

const identity = (s: StoreState) => s

/**
 * Store hook with shallow comparison applied to every selector, so selectors that
 * derive arrays (e.g. `.filter(...)`) stay referentially stable between renders.
 */
export function useStore(): StoreState
export function useStore<T>(selector: (s: StoreState) => T): T
export function useStore<T>(selector?: (s: StoreState) => T) {
  return useBoundStore(useShallow((selector ?? identity) as (s: StoreState) => T))
}
useStore.getState = useBoundStore.getState
useStore.setState = useBoundStore.setState
useStore.subscribe = useBoundStore.subscribe
useStore.persist = useBoundStore.persist

export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}
