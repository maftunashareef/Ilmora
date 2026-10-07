import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { createSeed } from '../data/seed'
import type {
  AttendanceRecord, Category, Center, Course, DemoState, Lang, LessonSession, Playlist, Publishable, Resource, Role, Section, SectionType,
  SiteConfig, Student, StudentProfile, Subject, Teacher, Video,
} from '../types'
import { emptyL } from '../i18n/useT'
import { enrolledCount, migratedCapacity } from '../lib/enrollment'
import { generateSessions, mergeSessions } from '../lib/sessions'

export type PageKey = keyof SiteConfig['pages']
export type ContentKind = 'course' | 'video' | 'playlist' | 'resource'

export interface Toast { id: number; text: string; tone?: 'ok' | 'warn' }

export type BuilderResult =
  | { ok: true }
  | { ok: false; reason: 'no-package' | 'limit' | 'duplicate' | 'conflict' | 'disabled' | 'full'; conflictWith?: string }

export type ActivateResult = { ok: true } | { ok: false; reason: 'incomplete' | 'full'; groupId?: string }

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
  setBuilderGrant: (studentId: string, meyosGrant: boolean) => void
  addBuilderGroup: (studentId: string, groupId: string) => BuilderResult
  removeBuilderCourse: (studentId: string, courseId: string) => void
  activateSubscription: (studentId: string) => ActivateResult
  renewSubscription: (studentId: string) => void
  cancelSubscription: (studentId: string) => void
  toggleSavedCourse: (studentId: string, courseId: string) => void
  toggleSavedTeacher: (studentId: string, teacherId: string) => void
  updateProfile: (studentId: string, patch: Partial<StudentProfile>) => void

  // Lessons & attendance
  generateGroupSessions: (groupId: string, days?: number) => number
  setSessionAttendance: (sessionId: string, open: boolean) => void
  setSessionStatus: (sessionId: string, status: LessonSession['status']) => void
  recordCheckIn: (record: AttendanceRecord) => void

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

const STORE_VERSION = 7
const freshState = () => ({ ...createSeed(), lang: 'uz' as Lang, role: 'visitor' as Role, currentTeacherId: 't-bekzod', currentStudentId: 's-aziz' })

/**
 * v6 → v7: groups gain `capacity` (replacing seats/enrolled), subscriptions gain
 * payment/funding records, lesson sessions + attendance are introduced, and the
 * card-only payment configuration + student attendance module are added.
 * Fallback capacity = previous `seats` (or 12), never below the current enrollment.
 */
function migrateV6toV7(persisted: Record<string, unknown>): Record<string, unknown> {
  const fresh = createSeed()
  const state = persisted as Partial<DemoState> & Record<string, unknown>
  const students: Student[] = (state.students ?? []).map((st) => ({
    ...st,
    subscription: {
      ...st.subscription,
      payment: st.subscription.payment ?? (st.subscription.status === 'active' ? { method: 'card', simulated: true, confirmedAt: st.subscription.startedAt ?? new Date().toISOString() } : undefined),
      funding: st.subscription.funding ?? { meyosGrant: false, courseIds: [] },
    },
    builder: { packageId: st.builder?.packageId ?? null, groupIds: st.builder?.groupIds ?? [], meyosGrant: st.builder?.meyosGrant ?? false },
  }))
  const courses: Course[] = (state.courses ?? []).map((c) => ({
    ...c,
    meyosGrant: c.meyosGrant ?? (c.id === 'c-bazis' ? true : undefined),
    groups: (c.groups ?? []).map((g) => {
      const legacy = g as unknown as { seats?: unknown; enrolled?: unknown; capacity?: unknown }
      const { seats: _s, enrolled: _e, ...rest } = legacy as Record<string, unknown>
      void _s; void _e
      const capacity = Number.isInteger(legacy.capacity) && Number(legacy.capacity) > 0 ? Number(legacy.capacity) : migratedCapacity(legacy.seats, enrolledCount(students, g.id))
      return { ...(rest as unknown as Omit<typeof g, 'capacity'>), capacity }
    }),
  }))
  const now = new Date()
  const from = new Date(now); from.setDate(from.getDate() - 14)
  const sessions: LessonSession[] = courses.flatMap((c) => c.groups.flatMap((g) => generateSessions(g, from, 35, now)))
  const site = state.site as SiteConfig
  const studentModules = site.dashboards.student.some((m) => m.id === 'attendance') ? site.dashboards.student : [...site.dashboards.student, { id: 'attendance', enabled: true }]
  return {
    ...state,
    students,
    courses,
    sessions: (state.sessions as LessonSession[] | undefined) ?? sessions,
    attendance: (state.attendance as AttendanceRecord[] | undefined) ?? [],
    site: { ...site, payments: site.payments ?? fresh.site.payments, dashboards: { ...site.dashboards, student: studentModules } },
  }
}

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

      upsertCourse: (c) =>
        set((s) => {
          // Keep lesson sessions in step with the course's groups (new groups get upcoming sessions).
          const now = new Date()
          const from = new Date(now); from.setDate(from.getDate() - 14)
          const generated = c.groups.flatMap((g) => generateSessions(g, from, 35, now))
          return { courses: upsert(s.courses, c), sessions: mergeSessions(s.sessions, generated) }
        }),
      removeCourse: (id) => set((s) => ({ courses: s.courses.filter((x) => x.id !== id), sessions: s.sessions.filter((x) => x.courseId !== id) })),
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
      removeStudent: (id) => set((s) => ({ students: s.students.filter((x) => x.id !== id), attendance: s.attendance.filter((a) => a.studentId !== id) })),
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
              return { ...st, builder: { ...st.builder, packageId, groupIds } }
            }),
          }
        }),
      setBuilderGrant: (studentId, meyosGrant) =>
        set((s) => ({ students: s.students.map((st) => (st.id === studentId ? { ...st, builder: { ...st.builder, meyosGrant } } : st)) })),
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
        // Shared capacity rule: the student's own current seat (if re-selecting) does not count against them.
        if (enrolledCount(s.students, groupId, studentId) >= target.capacity) return { ok: false, reason: 'full' }
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
        if (!st || !pkg || st.builder.groupIds.length !== pkg.maxCourses) return { ok: false, reason: 'incomplete' }
        const allGroups = s.courses.flatMap((c) => c.groups)
        // Capacity is enforced again at activation: seats may have been taken since the builder step.
        for (const gid of st.builder.groupIds) {
          const g = allGroups.find((x) => x.id === gid)
          if (!g) return { ok: false, reason: 'incomplete' }
          if (enrolledCount(s.students, gid, studentId) >= g.capacity) return { ok: false, reason: 'full', groupId: gid }
        }
        const grantCourses = st.builder.meyosGrant
          ? st.builder.groupIds.map((gid) => allGroups.find((g) => g.id === gid)?.courseId).filter((cid): cid is string => !!cid && !!s.courses.find((c) => c.id === cid)?.meyosGrant)
          : []
        const method = s.site.payments.methods.find((m) => m.enabled)?.id ?? 'card'
        const today = new Date()
        const renew = new Date(today)
        renew.setMonth(renew.getMonth() + 1)
        set((state) => ({
          students: state.students.map((x) =>
            x.id === studentId
              ? {
                  ...x,
                  subscription: {
                    packageId: pkg.id,
                    groupIds: [...st.builder.groupIds],
                    status: 'active',
                    startedAt: today.toISOString().slice(0, 10),
                    renewsAt: renew.toISOString().slice(0, 10),
                    payment: { method, simulated: true, confirmedAt: today.toISOString() },
                    funding: { meyosGrant: st.builder.meyosGrant && grantCourses.length > 0, courseIds: grantCourses },
                  },
                }
              : x,
          ),
        }))
        return { ok: true }
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

      generateGroupSessions: (groupId, days = 28) => {
        const s = get()
        const group = s.courses.flatMap((c) => c.groups).find((g) => g.id === groupId)
        if (!group) return 0
        const generated = generateSessions(group, new Date(), days)
        const merged = mergeSessions(s.sessions, generated)
        const added = merged.length - s.sessions.length
        if (added > 0) set({ sessions: merged })
        return added
      },
      setSessionAttendance: (sessionId, open) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, attendanceOpen: open, ...(open ? { openedAt: new Date().toISOString() } : { closedAt: new Date().toISOString() }) } : x,
          ),
        })),
      setSessionStatus: (sessionId, status) =>
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, status, attendanceOpen: status === 'cancelled' ? false : x.attendanceOpen } : x)) })),
      recordCheckIn: (record) =>
        set((s) => (s.attendance.some((r) => r.sessionId === record.sessionId && r.studentId === record.studentId) ? {} : { attendance: [...s.attendance, record] })),

      resetDemo: () => {
        set(freshState())
      },
    }),
    {
      name: 'ilmora-demo-v1',
      version: STORE_VERSION,
      // Object URLs from local uploads are transient — never persisted.
      storage: createJSONStorage(() => localStorage, { replacer: (key, value) => (key === 'previewUrl' ? undefined : value) }),
      partialize: (s) => {
        const { toasts: _toasts, ...rest } = s
        void _toasts
        return rest as StoreState
      },
      migrate: (persisted, version) => {
        if (version === STORE_VERSION) return persisted as StoreState
        // v6 (first public release) migrates in place; anything older predates the demo and is reset to the seed.
        if (version === 6) return migrateV6toV7(persisted as Record<string, unknown>) as unknown as StoreState
        return freshState() as unknown as StoreState
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
