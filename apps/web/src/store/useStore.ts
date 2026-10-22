'use client'
import { createContext, createElement, useContext, useEffect, useRef, type ReactNode } from 'react'
import { createStore, type StoreApi } from 'zustand'
import { shallow } from 'zustand/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { overlaps, sampleData, toMin as sharedToMin } from '@ilmora/shared'
import { api, isApiError, refreshSession, session } from '../lib/api'
import { enrolledCount, publishSeatCounts } from '../lib/enrollment'
import type {
  AttendanceRecord, Category, Center, Course, DemoState, Lang, LessonSession, Playlist, Publishable, Resource, Role, Section, SectionType, SiteConfig, Student,
  StudentProfile, Subject, Teacher, Video,
} from '../types'

export type PageKey = keyof SiteConfig['pages']
export type ContentKind = 'course' | 'video' | 'playlist' | 'resource'
export interface Toast { id: number; text: string; tone?: 'ok' | 'warn' }
export type BuilderResult = { ok: true } | { ok: false; reason: 'no-package' | 'limit' | 'duplicate' | 'conflict' | 'disabled' | 'full'; conflictWith?: string }
export type PaymentProviderId = 'PAYME' | 'CLICK'

export interface AuthUser {
  id: string
  login: string | null
  phone: string | null
  displayName: string
  district: string | null
  preferredLang: Lang
  reminders: boolean
  roles: ('PLATFORM_ADMIN' | 'FINANCE_ADMIN' | 'CENTER_ADMIN' | 'TEACHER' | 'STUDENT')[]
  centerId: string | null
  teacherProfileId: string | null
  offerAcceptedAt: string | null
  offerVersion: string | null
  consentAt: string | null
  marketing: boolean
}

export interface ConsentInput { acceptOffer: true; consentPersonalData: true }
export interface RegisterInput extends ConsentInput { role: 'STUDENT' | 'TEACHER'; login: string; password: string; displayName?: string }

export interface PaymentSummary {
  id: string; state: string; provider: string | null; amountMinor: string; currency: string; periodStart: string; periodEnd: string; paidAt: string | null; expiresAt: string; createdAt: string
}

export interface CheckInOutcome {
  ok: boolean
  alreadyRecorded?: boolean
  reason?: 'invalid-link' | 'expired' | 'closed' | 'not-enrolled'
  record?: { checkedInAt: string }
  session?: { id: string; date: string; start?: string }
}

export interface InitialData {
  lang: Lang
  site: SiteConfig & { version?: number }
  catalog: { centers: Center[]; categories: Category[]; teachers: Teacher[]; subjects: Subject[]; courses: Course[] }
}

interface Actions {
  // UI / auth
  setLang: (lang: Lang) => void
  setCurrentTeacher: (id: string) => void
  setCurrentStudent: (id: string) => void
  notify: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
  bootstrap: () => Promise<void>
  register: (input: RegisterInput) => Promise<AuthUser>
  login: (login: string, password: string) => Promise<AuthUser>
  giveConsent: (input: ConsentInput) => Promise<AuthUser>
  logout: () => Promise<void>
  ensureWorkspace: () => Promise<void>
  loadGroupDetail: (groupId: string) => Promise<void>
  loadMyAttendance: () => Promise<void>
  loadStudentOverview: () => Promise<void>

  // Site config (Super Admin)
  patchSite: (fn: (site: SiteConfig) => SiteConfig) => void
  updateSection: (page: PageKey, id: string, patch: Partial<Section>) => void
  moveSection: (page: PageKey, id: string, dir: -1 | 1) => void
  addSection: (page: PageKey, type: SectionType) => void
  removeSection: (page: PageKey, id: string) => void
  restorePageDefaults: (page: PageKey) => void
  restoreThemeDefaults: () => void

  // Entities
  upsertCourse: (c: Course) => Promise<void>
  removeCourse: (id: string) => Promise<void>
  upsertVideo: (v: Video) => Promise<void>
  removeVideo: (id: string) => Promise<void>
  upsertPlaylist: (p: Playlist) => Promise<void>
  removePlaylist: (id: string) => Promise<void>
  upsertResource: (r: Resource) => Promise<void>
  removeResource: (id: string) => Promise<void>
  upsertTeacher: (t: Teacher) => Promise<void>
  removeTeacher: (id: string) => Promise<void>
  upsertSubject: (s: Subject) => Promise<void>
  removeSubject: (id: string) => Promise<void>
  upsertCenter: (c: Center) => Promise<void>
  removeCenter: (id: string) => boolean
  upsertCategory: (c: Category) => Promise<void>
  removeCategory: (id: string) => boolean
  upsertStudent: (s: Student) => Promise<void>
  removeStudent: (id: string) => Promise<void>
  setPublishable: (kind: ContentKind, id: string, patch: Partial<Publishable>) => Promise<void>

  // Student
  setBuilderPackage: (studentId: string, packageId: string | null) => void
  setBuilderGrant: (studentId: string, meyosGrant: boolean) => void
  addBuilderGroup: (studentId: string, groupId: string) => BuilderResult
  removeBuilderCourse: (studentId: string, courseId: string) => void
  checkout: (provider: PaymentProviderId) => Promise<{ url: string; paymentId: string }>
  renewSubscription: (studentId: string, provider?: PaymentProviderId) => Promise<void>
  cancelSubscription: (studentId: string) => Promise<void>
  toggleSavedCourse: (studentId: string, courseId: string) => void
  toggleSavedTeacher: (studentId: string, teacherId: string) => void
  updateProfile: (studentId: string, patch: Partial<StudentProfile>) => Promise<void>
  checkIn: (input: { sessionId: string; token: string }) => Promise<CheckInOutcome>

  // Lessons & attendance (teacher)
  generateGroupSessions: (groupId: string, days?: number) => Promise<number>
  setSessionAttendance: (sessionId: string, open: boolean) => Promise<void>
  setSessionStatus: (sessionId: string, status: LessonSession['status']) => Promise<void>
  correctAttendance: (sessionId: string, studentId: string, status: 'PRESENT' | 'ABSENT' | 'EXCUSED', reason: string) => Promise<void>
  applyAttendanceEvent: (event: { type: string; session?: unknown; record?: unknown }) => void
  recordCheckIn: (record: AttendanceRecord) => void
}

export interface StoreState extends DemoState, Actions {
  lang: Lang
  role: Role
  currentTeacherId: string
  currentStudentId: string
  toasts: Toast[]
  auth: { status: 'idle' | 'loading' | 'anonymous' | 'authenticated'; user: AuthUser | null }
  siteVersion: number
  workspaceLoaded: boolean
  myPayments: PaymentSummary[]
  /** Latest QR token/url per session (teacher side, returned when attendance is opened). */
  sessionQr: Record<string, { token: string; url: string }>
}

const upsertIn = <T extends { id: string }>(list: T[], item: T): T[] => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item])
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
export const toMin = sharedToMin
const DRAFT_KEY = 'ilmora-builder-draft'
let toastSeq = 1

const roleOf = (u: AuthUser | null): Role => (!u ? 'visitor' : u.roles.includes('PLATFORM_ADMIN') ? 'admin' : u.roles.includes('TEACHER') ? 'teacher' : 'student')

const emptyStudent = (u: AuthUser): Student => ({
  id: u.id,
  profile: { displayName: u.displayName, district: u.district ?? '', preferredLang: u.preferredLang, reminders: u.reminders },
  subscription: { packageId: null, groupIds: [], status: 'none' },
  savedCourseIds: [],
  savedTeacherIds: [],
  builder: { packageId: null, groupIds: [], meyosGrant: false },
})

// ───────── payload mappers (web shape → API input) ─────────
const publishableInput = (p: Partial<Publishable>) => ({
  ...(p.status ? { status: p.status } : {}), ...(p.visibility ? { visibility: p.visibility } : {}), ...(p.audience ? { audience: p.audience } : {}),
  ...(p.featured !== undefined ? { featured: p.featured } : {}), ...(p.reviewRequested !== undefined ? { reviewRequested: p.reviewRequested } : {}),
})
const courseInput = (c: Course) => ({
  title: c.title, categoryId: c.categoryId, centerId: c.centerId, teacherId: c.teacherId, subjectId: c.subjectId ?? null, summary: c.summary, description: c.description, curriculum: c.curriculum,
  level: c.level, durationMonths: c.durationMonths, price: Math.round(c.price), coverSeed: c.coverSeed, imageUrl: c.imageUrl ?? null, meyosGrant: !!c.meyosGrant, ...publishableInput(c),
})
const groupInput = (g: Course['groups'][number]) => ({ name: g.name, days: g.days, start: g.start, end: g.end, room: g.room, capacity: g.capacity })
const videoInput = (v: Video) => ({
  teacherId: v.teacherId, courseId: v.courseId ?? null, title: v.title, description: v.description,
  source: v.source.kind === 'link' ? { kind: 'link' as const, url: v.source.url } : { kind: 'upload' as const, key: v.source.file.name, url: v.source.file.previewUrl },
  durationSec: v.durationSec, thumbnailUrl: v.thumbnailUrl ?? null, coverSeed: v.coverSeed, ...publishableInput(v),
})
const playlistInput = (p: Playlist) => ({ teacherId: p.teacherId, title: p.title, description: p.description, videoIds: p.videoIds, coverSeed: p.coverSeed, ...publishableInput(p) })
const resourceInput = (r: Resource) => ({
  teacherId: r.teacherId, courseId: r.courseId ?? null, title: r.title, description: r.description, kind: r.kind,
  file: r.file ? { name: r.file.name, size: r.file.size, mime: r.file.mime } : null, url: r.url ?? null, pages: r.pages ?? null, ...publishableInput(r),
})
const teacherInput = (t: Teacher) => ({
  name: t.name, title: t.title, bio: t.bio, expertise: t.expertise, centerId: t.centerId, avatarSeed: t.avatarSeed, bannerTone: t.bannerTone, avatarUrl: t.avatarUpload?.previewUrl ?? null,
  bannerUrl: t.bannerUpload?.previewUrl ?? null, tagline: t.tagline, channelActive: t.channelActive, featured: t.featured ?? null,
})

/** API video → web shape (uploads carry a key + optional URL). */
const mapVideo = (v: Video & { source: { kind: string; url?: string; key?: string } }): Video => ({
  ...v,
  source: v.source.kind === 'upload' ? { kind: 'upload', file: { name: v.source.key ?? 'upload', size: 0, mime: 'video/*', previewUrl: v.source.url } } : { kind: 'link', url: v.source.url ?? '' },
})

type ApiOverview = {
  builder: { packageId: string | null; groupIds: string[]; meyosGrant: boolean }
  subscription: { id: string; packageId: string | null; status: string; groupIds: string[]; startedAt: string | null; currentPeriodStart: string | null; currentPeriodEnd: string | null; funding: { meyosGrant: boolean; courseIds: string[] } } | null
  payments: PaymentSummary[]
}

export function createIlmoraStore(initial: InitialData): StoreApi<StoreState> {
  const { version: siteVersion = 1, ...site } = initial.site
  const catalogGroups = initial.catalog.courses.flatMap((c) => c.groups)
  publishSeatCounts(catalogGroups)
  const readDraft = (): Student['builder'] | null => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DRAFT_KEY) : null
      return raw ? (JSON.parse(raw) as Student['builder']) : null
    } catch {
      return null
    }
  }
  const writeDraft = (b: Student['builder']) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(b))
    } catch {
      /* private mode */
    }
  }

  return createStore<StoreState>()((set, get) => {
    const toast = (err: unknown) => {
      const text = isApiError(err) ? err.message : err instanceof Error ? err.message : String(err)
      get().notify(text, 'warn')
    }
    const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } catch (err) {
        toast(err)
        throw err
      }
    }
    let saveSiteTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleSiteSave = () => {
      if (get().role !== 'admin') return
      clearTimeout(saveSiteTimer)
      saveSiteTimer = setTimeout(async () => {
        const { packages: _p, ...data } = get().site
        void _p
        try {
          const r = await api<{ version: number }>('/admin/site', { method: 'PUT', body: { data, version: get().siteVersion } })
          set({ siteVersion: r.version })
        } catch (err) {
          toast(err)
        }
      }, 800)
    }
    const patchMe = (fn: (st: Student) => Student) => set((s) => ({ students: s.students.map((st) => (st.id === s.currentStudentId ? fn(st) : st)) }))
    let draftTimer: ReturnType<typeof setTimeout> | undefined
    const syncDraft = () => {
      const me = get().students.find((x) => x.id === get().currentStudentId)
      if (!me) return
      writeDraft(me.builder)
      if (get().auth.status !== 'authenticated') return
      clearTimeout(draftTimer)
      draftTimer = setTimeout(() => {
        api('/student/subscription/draft', { method: 'PUT', body: { packageId: me.builder.packageId, groupIds: me.builder.groupIds, meyosGrant: me.builder.meyosGrant } }).catch(toast)
      }, 500)
    }
    const applyAuth = (user: AuthUser | null) => {
      const role = roleOf(user)
      set((s) => ({
        auth: { status: user ? 'authenticated' : 'anonymous', user },
        role,
        currentStudentId: user?.id ?? '',
        currentTeacherId: user?.teacherProfileId ?? '',
        students: user ? upsertIn(s.students.filter((x) => x.id !== user.id), { ...emptyStudent(user), builder: readDraft() ?? { packageId: null, groupIds: [], meyosGrant: false } }) : s.students,
        workspaceLoaded: false,
      }))
    }
    /** Store the access token, apply the account and warm the student overview; used by every sign-in path. */
    const openSession = async (r: { accessToken: string; user: AuthUser }) => {
      session.set(r.accessToken)
      applyAuth(r.user)
      if (r.user.roles.includes('STUDENT')) await get().loadStudentOverview().catch(() => undefined)
      return r.user
    }
    const refreshWorkspace = async () => {
      const mine = await api<{ teacher: Teacher | null; courses: Course[]; videos: Video[]; playlists: Playlist[]; resources: Resource[]; subjects: Subject[] }>('/manage/mine')
      publishSeatCounts(mine.courses.flatMap((c) => c.groups))
      set((s) => ({
        teachers: mine.teacher ? upsertIn(s.teachers, mine.teacher) : s.teachers,
        courses: get().role === 'admin' ? mine.courses : [...s.courses.filter((c) => !mine.courses.some((m) => m.id === c.id)), ...mine.courses],
        videos: mine.videos.map((v) => mapVideo(v as Video & { source: { kind: string; url?: string; key?: string } })),
        playlists: mine.playlists,
        resources: mine.resources,
        subjects: get().role === 'admin' ? mine.subjects : [...s.subjects.filter((x) => !mine.subjects.some((m) => m.id === x.id)), ...mine.subjects],
      }))
      if (get().role === 'admin') {
        const users = await api<{ items: { id: string; displayName: string; district: string | null; preferredLang: Lang; roles: string[]; subscription: { packageId: string | null; status: string; startedAt: string | null; currentPeriodEnd: string | null } | null; groupIds: string[] }[] }>('/admin/users?pageSize=200')
        set((s) => ({
          students: [
            ...s.students.filter((x) => x.id === s.currentStudentId && !users.items.some((u) => u.id === x.id)),
            ...users.items.map((u) => ({
              id: u.id,
              profile: { displayName: u.displayName, district: u.district ?? '', preferredLang: u.preferredLang, reminders: true },
              subscription: { packageId: u.subscription?.packageId ?? null, groupIds: u.groupIds, status: (u.subscription?.status === 'ACTIVE' ? 'active' : 'none') as 'active' | 'none', startedAt: u.subscription?.startedAt ?? undefined, renewsAt: u.subscription?.currentPeriodEnd ?? undefined },
              savedCourseIds: [], savedTeacherIds: [], builder: { packageId: null, groupIds: [], meyosGrant: false },
            })),
          ],
        }))
      }
      set({ workspaceLoaded: true })
    }

    return {
      ...initial.catalog,
      site,
      siteVersion,
      videos: [],
      playlists: [],
      resources: [],
      students: [],
      sessions: [],
      attendance: [],
      lang: initial.lang,
      role: 'visitor',
      currentTeacherId: '',
      currentStudentId: '',
      toasts: [],
      auth: { status: 'idle', user: null },
      workspaceLoaded: false,
      myPayments: [],
      sessionQr: {},

      // ── UI ──
      setLang: (lang) => set({ lang }),
      setCurrentTeacher: (id) => set({ currentTeacherId: id }),
      setCurrentStudent: (id) => set({ currentStudentId: id }),
      notify: (text, tone = 'ok') => {
        const id = toastSeq++
        set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
        setTimeout(() => get().dismissToast(id), 3600)
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      // ── auth ──
      bootstrap: async () => {
        if (get().auth.status !== 'idle') return
        set({ auth: { status: 'loading', user: null } })
        // Only call /auth/refresh when the API left its session flag cookie; anonymous visitors cause no 401 noise.
        const hasSession = typeof document !== 'undefined' && /(?:^|;\s*)ilmora_session=1(?:;|$)/.test(document.cookie)
        const ok = session.token ? true : hasSession ? await refreshSession() : false
        if (!ok) { applyAuth(null); return }
        try {
          const user = await api<AuthUser>('/auth/me')
          applyAuth(user)
          if (user.roles.includes('STUDENT')) await get().loadStudentOverview()
        } catch {
          session.set(null)
          applyAuth(null)
        }
      },
      register: (input) => api<{ accessToken: string; user: AuthUser }>('/auth/register', { method: 'POST', body: { ...input, lang: get().lang }, credentials: true, auth: false }).then(openSession),
      login: (login, password) => api<{ accessToken: string; user: AuthUser }>('/auth/login', { method: 'POST', body: { login, password }, credentials: true, auth: false }).then(openSession),
      giveConsent: async (input) => {
        const user = await api<AuthUser>('/auth/consent', { method: 'POST', body: input })
        set((s) => ({ auth: { ...s.auth, user } }))
        return user
      },
      logout: async () => {
        await api('/auth/logout', { method: 'POST', credentials: true }).catch(() => undefined)
        session.set(null)
        applyAuth(null)
        set({ sessions: [], attendance: [], myPayments: [] })
      },
      ensureWorkspace: async () => {
        // The workspace (own courses, videos, people) exists for teachers and admins only.
        if (get().workspaceLoaded || get().role === 'visitor' || get().role === 'student') return
        await guard(refreshWorkspace)
      },
      loadStudentOverview: async () => {
        const o = await api<ApiOverview>('/student/subscription')
        const localDraft = readDraft()
        patchMe((st) => ({
          ...st,
          subscription: o.subscription
            ? { packageId: o.subscription.packageId, groupIds: o.subscription.groupIds, status: o.subscription.status === 'ACTIVE' || o.subscription.status === 'PAST_DUE' ? 'active' : 'none', startedAt: o.subscription.startedAt ?? undefined, renewsAt: o.subscription.currentPeriodEnd ?? undefined, funding: o.subscription.funding }
            : { packageId: null, groupIds: [], status: 'none' },
          builder: o.builder.packageId || o.builder.groupIds.length ? o.builder : (localDraft ?? st.builder),
        }))
        set({ myPayments: o.payments })
        if (localDraft && !o.builder.packageId && !o.builder.groupIds.length && (localDraft.packageId || localDraft.groupIds.length)) syncDraft()
        const saved = await api<{ courseIds: string[]; teacherIds: string[] }>('/student/saved').catch(() => ({ courseIds: [], teacherIds: [] }))
        patchMe((st) => ({ ...st, savedCourseIds: saved.courseIds, savedTeacherIds: saved.teacherIds }))
      },
      loadGroupDetail: async (groupId) => {
        const d = await guard(() => api<{ group: Course['groups'][number]; roster: { id: string; displayName: string; district: string | null; packageId: string | null; since: string }[]; sessions: (LessonSession & { records: { studentId: string; status: string; method: string; checkedInAt: string }[] })[] }>(`/manage/groups/${groupId}`))
        publishSeatCounts([d.group])
        set((s) => {
          const roster: Student[] = d.roster.map((r) => {
            const existing = s.students.find((x) => x.id === r.id)
            const groupIds = Array.from(new Set([...(existing?.subscription.groupIds ?? []), groupId]))
            return existing
              ? { ...existing, subscription: { ...existing.subscription, status: 'active', groupIds, packageId: existing.subscription.packageId ?? r.packageId, startedAt: existing.subscription.startedAt ?? r.since } }
              : { id: r.id, profile: { displayName: r.displayName, district: r.district ?? '', preferredLang: 'uz', reminders: true }, subscription: { packageId: r.packageId, groupIds, status: 'active', startedAt: r.since }, savedCourseIds: [], savedTeacherIds: [], builder: { packageId: null, groupIds: [], meyosGrant: false } }
          })
          const others = s.students.filter((x) => !roster.some((r) => r.id === x.id))
          const sessions = d.sessions.map(({ records: _r, ...ses }) => { void _r; return { ...ses, token: '' } as LessonSession })
          const records: AttendanceRecord[] = d.sessions.flatMap((ses) => ses.records.map((r) => ({ id: `att-${ses.id}-${r.studentId}`, sessionId: ses.id, studentId: r.studentId, checkedInAt: r.checkedInAt, method: r.method as 'qr' | 'manual', status: r.status })))
          return {
            students: [...others, ...roster],
            sessions: [...s.sessions.filter((x) => x.groupId !== groupId), ...sessions],
            attendance: [...s.attendance.filter((a) => !sessions.some((x) => x.id === a.sessionId)), ...records],
          }
        })
      },
      loadMyAttendance: async () => {
        const d = await guard(() => api<{ sessions: LessonSession[]; records: AttendanceRecord[] }>('/student/attendance'))
        const me = get().currentStudentId
        set((s) => ({
          sessions: [...s.sessions.filter((x) => !d.sessions.some((n) => n.id === x.id)), ...d.sessions.map((x) => ({ ...x, token: '' }))],
          attendance: [...s.attendance.filter((a) => a.studentId !== me), ...d.records],
        }))
      },

      // ── site ──
      patchSite: (fn) => { set((s) => ({ site: fn(s.site) })); scheduleSiteSave() },
      updateSection: (page, id, patch) => get().patchSite((site) => ({ ...site, pages: { ...site.pages, [page]: site.pages[page].map((sec) => (sec.id === id ? { ...sec, ...patch } : sec)) } })),
      moveSection: (page, id, dir) =>
        get().patchSite((site) => {
          const list = [...site.pages[page]]
          const i = list.findIndex((x) => x.id === id)
          const j = i + dir
          if (i < 0 || j < 0 || j >= list.length) return site
          ;[list[i], list[j]] = [list[j], list[i]]
          return { ...site, pages: { ...site.pages, [page]: list } }
        }),
      addSection: (page, type) => get().patchSite((site) => ({ ...site, pages: { ...site.pages, [page]: [...site.pages[page], { id: uid('sec'), type, enabled: true, title: { uz: '', ru: '', en: '' }, subtitle: { uz: '', ru: '', en: '' }, body: { uz: '', ru: '', en: '' }, items: [] }] } })),
      removeSection: (page, id) => get().patchSite((site) => ({ ...site, pages: { ...site.pages, [page]: site.pages[page].filter((x) => x.id !== id) } })),
      restorePageDefaults: (page) => get().patchSite((site) => ({ ...site, pages: { ...site.pages, [page]: JSON.parse(JSON.stringify(sampleData.site.pages[page])) } })),
      restoreThemeDefaults: () => get().patchSite((site) => ({ ...site, theme: JSON.parse(JSON.stringify(sampleData.site.theme)) })),

      // ── entities ──
      upsertCourse: async (c) => {
        await guard(async () => {
          const existing = get().courses.find((x) => x.id === c.id)
          let saved: Course
          if (existing) saved = await api<Course>(`/manage/courses/${c.id}`, { method: 'PATCH', body: courseInput(c) })
          else saved = await api<Course>('/manage/courses', { method: 'POST', body: courseInput(c) })
          const before = existing?.groups ?? []
          for (const g of c.groups) {
            const prev = before.find((x) => x.id === g.id)
            if (!prev) await api(`/manage/courses/${saved.id}/groups`, { method: 'POST', body: groupInput(g) })
            else if (JSON.stringify(groupInput(prev)) !== JSON.stringify(groupInput(g))) await api(`/manage/groups/${g.id}`, { method: 'PATCH', body: groupInput(g) })
          }
          for (const g of before) if (!c.groups.some((x) => x.id === g.id)) await api(`/manage/groups/${g.id}`, { method: 'DELETE' })
          await refreshWorkspace()
        })
      },
      removeCourse: async (id) => { await guard(() => api(`/manage/courses/${id}`, { method: 'DELETE' })); set((s) => ({ courses: s.courses.filter((x) => x.id !== id), sessions: s.sessions.filter((x) => x.courseId !== id) })) },
      upsertVideo: async (v) => {
        const saved = await guard(() => (get().videos.some((x) => x.id === v.id) ? api<Video>(`/manage/videos/${v.id}`, { method: 'PATCH', body: videoInput(v) }) : api<Video>('/manage/videos', { method: 'POST', body: videoInput(v) })))
        set((s) => ({ videos: upsertIn(s.videos.filter((x) => x.id !== v.id), mapVideo(saved as Video & { source: { kind: string; url?: string; key?: string } })) }))
      },
      removeVideo: async (id) => { await guard(() => api(`/manage/videos/${id}`, { method: 'DELETE' })); set((s) => ({ videos: s.videos.filter((x) => x.id !== id), playlists: s.playlists.map((p) => ({ ...p, videoIds: p.videoIds.filter((v) => v !== id) })) })) },
      upsertPlaylist: async (p) => {
        const saved = await guard(() => (get().playlists.some((x) => x.id === p.id) ? api<Playlist>(`/manage/playlists/${p.id}`, { method: 'PATCH', body: playlistInput(p) }) : api<Playlist>('/manage/playlists', { method: 'POST', body: playlistInput(p) })))
        set((s) => ({ playlists: upsertIn(s.playlists.filter((x) => x.id !== p.id), saved) }))
      },
      removePlaylist: async (id) => { await guard(() => api(`/manage/playlists/${id}`, { method: 'DELETE' })); set((s) => ({ playlists: s.playlists.filter((x) => x.id !== id) })) },
      upsertResource: async (r) => {
        const saved = await guard(() => (get().resources.some((x) => x.id === r.id) ? api<Resource>(`/manage/resources/${r.id}`, { method: 'PATCH', body: resourceInput(r) }) : api<Resource>('/manage/resources', { method: 'POST', body: resourceInput(r) })))
        set((s) => ({ resources: upsertIn(s.resources.filter((x) => x.id !== r.id), saved) }))
      },
      removeResource: async (id) => { await guard(() => api(`/manage/resources/${id}`, { method: 'DELETE' })); set((s) => ({ resources: s.resources.filter((x) => x.id !== id) })) },
      upsertTeacher: async (t) => {
        const saved = await guard(() => (get().teachers.some((x) => x.id === t.id) ? api<Teacher>(`/admin/teachers/${t.id}`, { method: 'PATCH', body: teacherInput(t) }) : api<Teacher>('/admin/teachers', { method: 'POST', body: teacherInput(t) })))
        set((s) => ({ teachers: upsertIn(s.teachers.filter((x) => x.id !== t.id), saved) }))
      },
      removeTeacher: async (id) => { await guard(() => api(`/admin/teachers/${id}`, { method: 'DELETE' })); set((s) => ({ teachers: s.teachers.filter((x) => x.id !== id) })) },
      upsertSubject: async (sub) => {
        const body = { teacherId: sub.teacherId, name: sub.name, description: sub.description }
        const saved = await guard(() => (get().subjects.some((x) => x.id === sub.id) ? api<Subject>(`/manage/subjects/${sub.id}`, { method: 'PUT', body }) : api<Subject>('/manage/subjects', { method: 'POST', body })))
        set((s) => ({ subjects: upsertIn(s.subjects.filter((x) => x.id !== sub.id), saved) }))
      },
      removeSubject: async (id) => { await guard(() => api(`/manage/subjects/${id}`, { method: 'DELETE' })); set((s) => ({ subjects: s.subjects.filter((x) => x.id !== id), courses: s.courses.map((c) => (c.subjectId === id ? { ...c, subjectId: undefined } : c)) })) },
      upsertCenter: async (c) => {
        const body = { name: c.name, district: c.district, description: c.description, tone: c.tone }
        const saved = await guard(() => (get().centers.some((x) => x.id === c.id) ? api<Center>(`/admin/centers/${c.id}`, { method: 'PUT', body }) : api<Center>('/admin/centers', { method: 'POST', body })))
        set((s) => ({ centers: upsertIn(s.centers.filter((x) => x.id !== c.id), saved) }))
      },
      removeCenter: (id) => {
        if (get().courses.some((c) => c.centerId === id) || get().teachers.some((t) => t.centerId === id)) return false
        set((s) => ({ centers: s.centers.filter((x) => x.id !== id) }))
        api(`/admin/centers/${id}`, { method: 'DELETE' }).catch(toast)
        return true
      },
      upsertCategory: async (c) => {
        const body = { name: c.name, glyph: c.glyph }
        const saved = await guard(() => (get().categories.some((x) => x.id === c.id) ? api<Category>(`/admin/categories/${c.id}`, { method: 'PUT', body }) : api<Category>('/admin/categories', { method: 'POST', body })))
        set((s) => ({ categories: upsertIn(s.categories.filter((x) => x.id !== c.id), saved) }))
      },
      removeCategory: (id) => {
        if (get().courses.some((c) => c.categoryId === id)) return false
        set((s) => ({ categories: s.categories.filter((x) => x.id !== id) }))
        api(`/admin/categories/${id}`, { method: 'DELETE' }).catch(toast)
        return true
      },
      upsertStudent: async (st) => {
        // Admins edit profile fields; enrollments change only through payments (seat holds + settlement).
        await guard(() => api(`/admin/users/${st.id}`, { method: 'PATCH', body: { displayName: st.profile.displayName, district: st.profile.district, preferredLang: st.profile.preferredLang } }))
        set((s) => ({ students: s.students.map((x) => (x.id === st.id ? { ...x, profile: st.profile } : x)) }))
      },
      removeStudent: async (id) => {
        await guard(() => api(`/admin/users/${id}/roles`, { method: 'PUT', body: { roles: ['STUDENT'], isActive: false, reason: 'Deactivated from the admin people screen' } }))
        set((s) => ({ students: s.students.filter((x) => x.id !== id) }))
      },
      setPublishable: async (kind, id, patch) => {
        const path = kind === 'course' ? `/manage/courses/${id}` : kind === 'video' ? `/manage/videos/${id}` : kind === 'playlist' ? `/manage/playlists/${id}` : `/manage/resources/${id}`
        const saved = await guard(() => api<Publishable & { id: string }>(path, { method: 'PATCH', body: publishableInput(patch) }))
        set((s) => {
          const map = <T extends Publishable & { id: string }>(list: T[]) => list.map((x) => (x.id === id ? { ...x, ...saved } : x))
          if (kind === 'course') return { courses: map(s.courses) }
          if (kind === 'video') return { videos: map(s.videos) }
          if (kind === 'playlist') return { playlists: map(s.playlists) }
          return { resources: map(s.resources) }
        })
      },

      // ── student ──
      setBuilderPackage: (studentId, packageId) => {
        const pkg = get().site.packages.find((p) => p.id === packageId)
        set((s) => ({ students: s.students.map((st) => (st.id === studentId ? { ...st, builder: { ...st.builder, packageId, groupIds: pkg ? st.builder.groupIds.slice(0, pkg.maxCourses) : st.builder.groupIds } } : st)) }))
        syncDraft()
      },
      setBuilderGrant: (studentId, meyosGrant) => { set((s) => ({ students: s.students.map((st) => (st.id === studentId ? { ...st, builder: { ...st.builder, meyosGrant } } : st)) })); syncDraft() },
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
        if (enrolledCount(s.students, groupId, studentId) >= target.capacity) return { ok: false, reason: 'full' }
        const current = st.builder.groupIds.map((id) => allGroups.find((g) => g.id === id)).filter(Boolean) as typeof allGroups
        const sameCourse = current.find((g) => g.courseId === target.courseId)
        const others = sameCourse ? current.filter((g) => g.courseId !== target.courseId) : current
        if (!sameCourse && others.length >= pkg.maxCourses) return { ok: false, reason: 'limit' }
        const clash = others.find((g) => overlaps(g, target))
        if (clash) return { ok: false, reason: 'conflict', conflictWith: clash.courseId }
        set((state) => ({ students: state.students.map((x) => (x.id === studentId ? { ...x, builder: { ...x.builder, groupIds: [...others.map((g) => g.id), groupId] } } : x)) }))
        syncDraft()
        return { ok: true }
      },
      removeBuilderCourse: (studentId, courseId) => {
        const allGroups = get().courses.flatMap((c) => c.groups)
        set((s) => ({ students: s.students.map((st) => (st.id === studentId ? { ...st, builder: { ...st.builder, groupIds: st.builder.groupIds.filter((id) => allGroups.find((g) => g.id === id)?.courseId !== courseId) } } : st)) }))
        syncDraft()
      },
      checkout: async (provider) => {
        const me = get().students.find((x) => x.id === get().currentStudentId)
        if (!me) throw new Error('Not signed in')
        await guard(() => api('/student/subscription/draft', { method: 'PUT', body: { packageId: me.builder.packageId, groupIds: me.builder.groupIds, meyosGrant: me.builder.meyosGrant } }))
        return guard(() => api<{ url: string; paymentId: string }>('/student/subscription/checkout', { method: 'POST', body: { provider, lang: get().lang } }))
      },
      renewSubscription: async (_studentId, provider = 'PAYME') => {
        const r = await guard(() => api<{ url: string }>('/student/subscription/renew', { method: 'POST', body: { provider, lang: get().lang } }))
        if (typeof window !== 'undefined') window.location.href = r.url
      },
      cancelSubscription: async () => {
        await guard(() => api('/student/subscription/cancel', { method: 'POST', body: {} }))
        await get().loadStudentOverview()
      },
      toggleSavedCourse: (studentId, courseId) => {
        const me = get().students.find((x) => x.id === studentId)
        const saved = !me?.savedCourseIds.includes(courseId)
        set((s) => ({ students: s.students.map((x) => (x.id === studentId ? { ...x, savedCourseIds: saved ? [...x.savedCourseIds, courseId] : x.savedCourseIds.filter((c) => c !== courseId) } : x)) }))
        if (get().auth.status === 'authenticated') api('/student/saved', { method: 'PUT', body: { kind: 'course', itemId: courseId, saved } }).catch(toast)
      },
      toggleSavedTeacher: (studentId, teacherId) => {
        const me = get().students.find((x) => x.id === studentId)
        const saved = !me?.savedTeacherIds.includes(teacherId)
        set((s) => ({ students: s.students.map((x) => (x.id === studentId ? { ...x, savedTeacherIds: saved ? [...x.savedTeacherIds, teacherId] : x.savedTeacherIds.filter((c) => c !== teacherId) } : x)) }))
        if (get().auth.status === 'authenticated') api('/student/saved', { method: 'PUT', body: { kind: 'teacher', itemId: teacherId, saved } }).catch(toast)
      },
      updateProfile: async (studentId, patch) => {
        const user = await guard(() => api<AuthUser>('/auth/me', { method: 'PATCH', body: { displayName: patch.displayName, district: patch.district, preferredLang: patch.preferredLang, reminders: patch.reminders } }))
        set((s) => ({ auth: { ...s.auth, user }, students: s.students.map((x) => (x.id === studentId ? { ...x, profile: { ...x.profile, ...patch } } : x)) }))
      },
      checkIn: (input) => guard(() => api<CheckInOutcome>('/attendance/check-in', { method: 'POST', body: input })),

      // ── teacher attendance ──
      generateGroupSessions: async (groupId, days = 28) => {
        const r = await guard(() => api<{ created: number }>(`/manage/groups/${groupId}/sessions/generate`, { method: 'POST', body: { days } }))
        await get().loadGroupDetail(groupId)
        return r.created
      },
      setSessionAttendance: async (sessionId, open) => {
        const r = await guard(() => api<{ session: LessonSession; token?: string; url?: string }>(`/teacher/sessions/${sessionId}/${open ? 'open' : 'close'}`, { method: 'POST', body: {} }))
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, ...r.session, token: r.token ?? '' } : x)),
          sessionQr: r.token && r.url ? { ...s.sessionQr, [sessionId]: { token: r.token, url: r.url } } : Object.fromEntries(Object.entries(s.sessionQr).filter(([k]) => k !== sessionId)),
        }))
      },
      setSessionStatus: async (sessionId, status) => {
        const r = await guard(() => api<{ session: LessonSession }>(`/teacher/sessions/${sessionId}`, { method: 'PATCH', body: { status } }))
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, ...r.session, token: x.token } : x)) }))
      },
      correctAttendance: async (sessionId, studentId, status, reason) => {
        const rec = await guard(() => api<{ id: string; sessionId: string; studentId: string; status: string; method: string; checkedInAt: string }>(`/teacher/sessions/${sessionId}/records`, { method: 'POST', body: { studentId, status, reason } }))
        get().applyAttendanceEvent({ type: 'record', record: rec })
      },
      applyAttendanceEvent: (event) => {
        if (event.type === 'record' && event.record) {
          const r = event.record as { id: string; sessionId: string; studentId: string; status: string; method: string; checkedInAt: string }
          set((s) => ({ attendance: upsertIn(s.attendance.filter((a) => !(a.sessionId === r.sessionId && a.studentId === r.studentId)), { id: `att-${r.sessionId}-${r.studentId}`, sessionId: r.sessionId, studentId: r.studentId, checkedInAt: r.checkedInAt, method: r.method as 'qr' | 'manual', status: r.status }) }))
        }
        if (event.type === 'session' && event.session) {
          const ses = event.session as LessonSession
          set((s) => ({ sessions: s.sessions.map((x) => (x.id === ses.id ? { ...x, ...ses, token: x.token } : x)) }))
        }
      },
      recordCheckIn: (record) => set((s) => (s.attendance.some((r) => r.sessionId === record.sessionId && r.studentId === record.studentId) ? {} : { attendance: [...s.attendance, record] })),
    }
  })
}

// ───────── React binding (per-request store; one instance in the browser) ─────────

const StoreContext = createContext<StoreApi<StoreState> | null>(null)
let browserStore: StoreApi<StoreState> | null = null

export function StoreProvider({ initial, children }: { initial: InitialData; children: ReactNode }) {
  const ref = useRef<StoreApi<StoreState> | null>(null)
  if (!ref.current) {
    ref.current = typeof window !== 'undefined' && browserStore ? browserStore : createIlmoraStore(initial)
    if (typeof window !== 'undefined') browserStore = ref.current
  }
  const store = ref.current
  useEffect(() => {
    if (store.getState().lang !== initial.lang) store.setState({ lang: initial.lang })
  }, [store, initial.lang])
  useEffect(() => {
    void store.getState().bootstrap()
  }, [store])
  return createElement(StoreContext.Provider, { value: store }, children)
}

const identity = (s: StoreState) => s

/** Store hook with shallow comparison applied to every selector (derived arrays stay referentially stable). */
export function useStore(): StoreState
export function useStore<T>(selector: (s: StoreState) => T): T
export function useStore<T>(selector?: (s: StoreState) => T) {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <StoreProvider>')
  return useStoreWithEqualityFn(store, (selector ?? identity) as (s: StoreState) => T, shallow)
}

/** Imperative access for non-React code in the browser (services, event streams). */
useStore.getState = () => {
  if (!browserStore) throw new Error('Store is not initialised in this environment')
  return browserStore.getState()
}
useStore.setState = (partial: Partial<StoreState>) => browserStore?.setState(partial)
