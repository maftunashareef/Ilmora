'use client'
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import { createStore, type StoreApi } from 'zustand'
import { shallow } from 'zustand/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { type AppNotification, type CenterCheckInFailure, type CenterKind, type MfaChallengeDto, type MfaSetupDto, courseSaveBody, groupSaveBody, isUniversityListed, publishableSaveBody, MAX_CART_COURSES, OFFER_VERSION, mergeCartGroups, overlaps, pickPresetGroups, presetCartPlan, sampleData, toMin as sharedToMin, translate } from '@ilmora/shared'
import { api, ApiError, isApiError, REFRESH_LIMITED, refreshRetryAfterSeconds, refreshSessionOutcome, session, setPasswordChangeRequiredHandler } from '../lib/api'
import { apiErrorText } from '../lib/apiErrors'
import { fetchStorageStatus, storableUrl } from '../services/uploads'
import { DEMO_LOGIN_ENABLED } from '../lib/demoMode'
import { enrolledCount, publishSeatCounts } from '../lib/enrollment'
import type {
  AttendanceRecord, Category, Center, Course, DemoState, Lang, LessonSession, Package, Permissions, Playlist, Preset, Publishable, Resource, Role, Section, SectionType, SiteConfig, Student,
  StudentProfile, Subject, Teacher, Video,
} from '../types'

export type PageKey = keyof SiteConfig['pages']
export type ContentKind = 'course' | 'video' | 'playlist' | 'resource'
export interface Toast { id: number; text: string; tone?: 'ok' | 'warn'; link?: { to: string; label: string } }
export type BuilderResult = { ok: true } | { ok: false; reason: 'no-package' | 'limit' | 'duplicate' | 'conflict' | 'disabled' | 'full'; conflictWith?: string }
/**
 * A ready-made package (university preparation) added to the cart as a whole, so the cart can show its courses together
 * under the university, direction and package name, and remove them together. Display only: the cart itself is still
 * the builder's group list, and the server never sees this. Kept on this device.
 */
export interface CartBundle { presetId: string; directionId?: string; courseIds: string[] }
export type PresetCartResult =
  | { ok: true; added: number; /** The Flex/Winx package the cart left for a custom selection, if it did. */ switchedFrom: string | null }
  | { ok: false; reason: 'unavailable' | 'limit' | 'full' | 'conflict'; courseId?: string; conflictWith?: string }
/** Payment goes through Payme only (decision of 10.11, security review №5, №6: Click removed from the API). */
export type PaymentProviderId = 'PAYME'

export interface AuthUser {
  id: string
  login: string | null
  phone: string | null
  displayName: string
  district: string | null
  preferredLang: Lang
  reminders: boolean
  roles: ('PLATFORM_ADMIN' | 'FINANCE_ADMIN' | 'CENTER_ADMIN' | 'CENTER_MANAGER' | 'TEACHER' | 'STUDENT' | 'INSTITUTION_ADMIN' | 'COMPANY_ADMIN' | 'MINISTRY')[]
  centerId: string | null
  teacherProfileId: string | null
  offerAcceptedAt: string | null
  offerVersion: string | null
  consentAt: string | null
  marketing: boolean
  /**
   * The password was issued by the Super Admin (a new ministry account or a reset) and not changed since: the site asks
   * for a new one right after sign-in, before anything else (POST /auth/password). Older API answers lack the field.
   */
  passwordChangeRequired?: boolean
}

/** `/auth/login` answered with the authenticator step instead of a session. */
export const isMfaChallenge = (r: unknown): r is MfaChallengeDto => !!r && typeof r === 'object' && (r as { mfaRequired?: unknown }).mfaRequired === true

export interface ConsentInput { acceptOffer: true; consentPersonalData: true; consentAbroad?: boolean; marketing?: boolean }
export type RegisterRole = 'STUDENT' | 'TEACHER' | 'CENTER' | 'INSTITUTION' | 'COMPANY'
/**
 * What `POST /auth/register` takes (the API refuses any other field). CENTER registers an Educational Center: the account
 * becomes its first administrator and `centerName` names the center. INSTITUTION (ТЗ 4.2) and COMPANY (ТЗ 4.3) are the
 * representative with their `jobTitle`; right after, the institution is claimed by STIR (services/institutions) or the
 * company profile is started (services/companies).
 */
export interface RegisterInput extends ConsentInput { role: RegisterRole; login: string; password: string; displayName?: string; phone?: string; centerName?: string; centerKind?: CenterKind; jobTitle?: string }

export interface PaymentSummary {
  id: string; state: string; provider: string | null; amountMinor: string; currency: string; periodStart: string; periodEnd: string; paidAt: string | null; expiresAt: string; createdAt: string
}

export interface CheckInOutcome {
  ok: boolean
  alreadyRecorded?: boolean
  reason?: 'invalid-link' | 'expired' | 'closed' | 'not-enrolled' | 'blocked'
  record?: { checkedInAt: string }
  session?: { id: string; date: string; start?: string }
}

/** Result of a check-in with the center's standing QR code. */
export interface CenterCheckInOutcome {
  ok: boolean
  alreadyRecorded?: boolean
  reason?: CenterCheckInFailure
  record?: { checkedInAt: string }
  session?: { id: string; date: string; start?: string }
  window?: { state: 'early' | 'open' | 'late'; opensAt: string; closesAt: string }
  distanceM?: number | null
}

export interface InitialData {
  lang: Lang
  /** The public read (`GET /public/site`): no role-permission matrix in it (Ж17), the store starts with NO_PERMISSIONS. */
  site: Omit<SiteConfig, 'permissions'> & { permissions?: Permissions; version?: number }
  catalog: { centers: Center[]; categories: Category[]; teachers: Teacher[]; subjects: Subject[]; courses: Course[] }
}

interface Actions {
  // UI / auth
  setLang: (lang: Lang) => void
  setCurrentTeacher: (id: string) => void
  setCurrentStudent: (id: string) => void
  notify: (text: string, tone?: Toast['tone'], link?: Toast['link']) => void
  dismissToast: (id: number) => void
  bootstrap: () => Promise<void>
  register: (input: RegisterInput) => Promise<AuthUser>
  /**
   * Login + password. The ministry and the Super Admins get no session yet but the authenticator step (`MfaChallengeDto`):
   * `setup` on the first sign-in (mfaSetup, then mfaConfirm), `verify` afterwards (mfaVerify).
   */
  login: (login: string, password: string) => Promise<AuthUser | MfaChallengeDto>
  /** First sign-in with the second factor: the secret to link the authenticator app (QR code). */
  mfaSetup: (challenge: string) => Promise<MfaSetupDto>
  /** The first code from the app links it and opens the session; the 10 recovery codes come only in this answer. */
  mfaConfirm: (challenge: string, code: string) => Promise<{ user: AuthUser; recoveryCodes: string[] }>
  /** A code from the app, or a recovery code, opens the session. */
  mfaVerify: (challenge: string, code: string) => Promise<AuthUser>
  loginAsDemo: (role: 'STUDENT' | 'TEACHER', customUser?: Partial<AuthUser>) => Promise<AuthUser>
  giveConsent: (input: ConsentInput) => Promise<AuthUser>
  /**
   * «Сменить пароль»: every session of the account ends and this browser gets a fresh one (the answer is a sign-in).
   * Errors: wrong_password, same_password, password_is_login, no_password; 5 tries.
   */
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthUser>
  /** «Забыли пароль?», step 1: an SMS code to the account's phone (`devCode` only on test servers). */
  requestPasswordCode: (phone: string) => Promise<{ expiresInSeconds: number; devCode?: string }>
  /**
   * «Забыли пароль?», step 2: the code and the new password; every session ends and this browser signs in (the answer
   * is a sign-in). Not for the ministry, Super Admins and finance (403 mfa_password_login) — the Super Admin resets those.
   */
  resetPasswordBySms: (phone: string, code: string, newPassword: string) => Promise<AuthUser>
  logout: () => Promise<void>
  ensureWorkspace: () => Promise<void>
  loadAdminPresets: () => Promise<void>
  /** Loads the signed-in account's own switches again (the retry on the «could not load» screen). */
  loadMyPermissions: () => Promise<void>
  /** Loads the visitor's saved cart and favorites from this device (called after mount, so server and first client render match). */
  hydrateGuest: () => void
  loadGroupDetail: (groupId: string) => Promise<void>
  loadMyAttendance: () => Promise<void>
  loadStudentOverview: () => Promise<void>
  /** Visitors and students: the videos, playlists and resources they may open (teachers and admins get theirs with the workspace). */
  loadPublicContent: () => Promise<void>
  /** Whether files can be uploaded in this environment; asked once, null until known. */
  ensureStorageStatus: () => Promise<boolean | null>
  setStorageConfigured: (configured: boolean) => void

  // Site config (Super Admin)
  patchSite: (fn: (site: SiteConfig) => SiteConfig) => void
  /** Super Admin: saves package fields through the packages API (packages are not part of the site save; id and code never change). */
  savePackage: (id: string, patch: Partial<Package>) => void
  /** Super Admin: creates a new, switched-off package through the packages API. */
  addPackage: () => Promise<void>
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
  /** Block the account (same request as the Accounts screen); `roles` are the account's current ones and are kept as they are. */
  deactivateStudent: (id: string, roles: string[]) => Promise<void>
  setPublishable: (kind: ContentKind, id: string, patch: Partial<Publishable>) => Promise<void>

  // Student
  setBuilderPackage: (studentId: string, packageId: string | null) => void
  setBuilderGrant: (studentId: string, meyosGrant: boolean) => void
  addBuilderGroup: (studentId: string, groupId: string) => BuilderResult
  removeBuilderCourse: (studentId: string, courseId: string) => void
  /**
   * Adds every course of a ready-made package in one step: one free, clash-free group per course, chosen automatically;
   * courses already in the cart are kept as they are. A Flex or Winx selection that no longer has exactly its number of
   * courses becomes a custom one. Nothing is added when a course cannot be placed.
   */
  addPresetToCart: (studentId: string, preset: Preset, opts?: { chosenOptional?: string[]; directionId?: string }) => PresetCartResult
  /** Removes a package's courses from the cart (those another package in the cart also includes stay). */
  removeCartBundle: (studentId: string, presetId: string) => void
  /** Empties the cart: every chosen course and package leaves it; the chosen Flex, Winx or custom mode stays. */
  clearBuilder: (studentId: string) => void
  /** Opens a payment; a free selection is activated at once and comes back with url null. */
  checkout: (provider: PaymentProviderId) => Promise<{ url: string | null; paymentId: string; free?: boolean }>
  renewSubscription: (studentId: string, provider?: PaymentProviderId) => Promise<void>
  toggleSavedCourse: (studentId: string, courseId: string) => void
  toggleSavedTeacher: (studentId: string, teacherId: string) => void
  updateProfile: (studentId: string, patch: Partial<StudentProfile>) => Promise<void>
  checkIn: (input: { sessionId: string; token: string }) => Promise<CheckInOutcome>
  centerCheckIn: (code: string, input: { sessionId: string; lat?: number; lng?: number; accuracyM?: number }) => Promise<CenterCheckInOutcome>

  // Notifications (every signed-in account)
  loadNotifications: () => Promise<void>
  /** Marks the given notifications read, or all of them when no ids are passed. */
  markNotificationsRead: (ids?: string[]) => Promise<void>

  // Lessons & attendance (teacher)
  generateGroupSessions: (groupId: string, days?: number) => Promise<number>
  setSessionAttendance: (sessionId: string, open: boolean) => Promise<void>
  refreshSessionQr: (sessionId: string) => Promise<{ session: LessonSession; token: string; url: string } | null>
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
  /** The visitor's saved cart and favourites have been read from this device (hydrateGuest ran). */
  guestHydrated: boolean
  /**
   * Super Admin only: the current settings were loaded from `GET /admin/site` — all of them (presets and universities
   * with the disabled ones, packages) and their version, from one answer. Until then site saves are refused: the page
   * was rendered from a cached public read, and its values must not go out with a fresh version.
   */
  presetsLoaded: boolean
  /** Super Admin only: that load failed — the workspace asks to refresh the page (no site saves until then). */
  siteLoadFailed: boolean
  /**
   * Ж17: where `site.permissions` stands. `idle` — a visitor (every switch off); `loading` — signed in, the account's
   * switches (`GET /me/permissions`, or the whole matrix from `GET /admin/site` for the Super Admin) are on their way;
   * `ready` — loaded; `error` — the load failed (switches stay off). Workspaces wait for `ready` (RequireRole), so a
   * teacher never acts on the all-off defaults.
   */
  permissionsStatus: 'idle' | 'loading' | 'ready' | 'error'
  myPayments: PaymentSummary[]
  /** Ready-made packages in the cart, read from this device after mount. */
  cartBundles: CartBundle[]
  /** Latest QR token/url per session (teacher side, returned when attendance is opened). */
  sessionQr: Record<string, { token: string; url: string }>
  /** The signed-in account's latest notifications and how many are unread. */
  notifications: AppNotification[]
  unreadCount: number
  /** Public content lists: not asked yet, in flight, or in the store (reloaded on every sign-in/out). */
  contentStatus: 'idle' | 'loading' | 'ready'
  /** The API has object storage for uploads (null = not asked yet). */
  storageConfigured: boolean | null
}

const upsertIn = <T extends { id: string }>(list: T[], item: T): T[] => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item])
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
export const toMin = sharedToMin
/** Local cart of a visitor who is not signed in; merged into the account (and removed) after login. */
const DRAFT_KEY = 'ilmora-builder-draft'
/** Courses a visitor saved while signed out; merged into the account's favorites after login. */
const GUEST_SAVED_KEY = 'ilmora-guest-saved-courses'
/** Ready-made packages in the cart (CartBundle); for visitors and signed-in students alike, on this device only. */
const CART_BUNDLES_KEY = 'ilmora-cart-bundles'
let toastSeq = 1

/** The workspace an account lands in. Teacher comes before center admin so accounts that are both keep the Teacher Studio; /center stays reachable from the account menu. */
export const roleOf = (u: AuthUser | null): Role => (!u ? 'visitor' : u.roles.includes('PLATFORM_ADMIN') ? 'admin' : u.roles.includes('TEACHER') ? 'teacher' : u.roles.includes('CENTER_ADMIN') || u.roles.includes('CENTER_MANAGER') ? 'center' : u.roles.includes('MINISTRY') ? 'ministry' : u.roles.includes('INSTITUTION_ADMIN') ? 'institution' : u.roles.includes('COMPANY_ADMIN') ? 'company' : 'student')

export const GUEST_STUDENT_ID = 'guest-student'
const emptyGuestStudent = (builder?: Student['builder'] | null, savedCourseIds: string[] = []): Student => ({
  id: GUEST_STUDENT_ID,
  profile: { displayName: '', district: '', preferredLang: 'uz', reminders: false },
  subscription: { packageId: null, groupIds: [], status: 'none' },
  savedCourseIds,
  savedTeacherIds: [],
  builder: builder ?? { packageId: null, groupIds: [], meyosGrant: false },
})

const emptyStudent = (u: AuthUser): Student => ({
  id: u.id,
  profile: { displayName: u.displayName, district: u.district ?? '', preferredLang: u.preferredLang, reminders: u.reminders },
  subscription: { packageId: null, groupIds: [], status: 'none' },
  savedCourseIds: [],
  savedTeacherIds: [],
  builder: { packageId: null, groupIds: [], meyosGrant: false },
})

// ───────── payload mappers (web shape → API input) ─────────
// The course, group and publish bodies come from @ilmora/shared (save-bodies.ts): the API checks the very same ones (Н1).
const publishableInput = publishableSaveBody
/**
 * Ж17: the role-permission matrix is not public. A visitor (and every account until its own switches arrive from
 * `GET /me/permissions`) has every switch off; the screens that read `site.permissions` need no other change.
 */
/** The pause before the one retry of `GET /me/permissions`. */
const PERMISSIONS_RETRY_MS = 1500
export const NO_PERMISSIONS: Permissions = {
  teacher: { editCourses: false, editPrices: false, editSchedules: false, publishDirectly: false, customizeChannel: false, manageGroups: false, uploadResources: false },
  student: { saveItems: false, switchGroups: false, downloadResources: false },
}
/** The account's own branches over the all-off defaults: a branch the API did not send (another role) stays off. */
export const ownPermissions = (own: Partial<Permissions> | null | undefined): Permissions => ({
  teacher: { ...NO_PERMISSIONS.teacher, ...own?.teacher },
  student: { ...NO_PERMISSIONS.student, ...own?.student },
})
/** What a visitor may see of the packages: published ones, and the universities marked published or with one. */
const publicSite = (site: SiteConfig): SiteConfig => {
  const presets = (site.presets ?? []).filter((p) => p.enabled)
  // The admin read also carries the switched-off packages (Ж17): they stay internal as well.
  return { ...site, presets, universities: (site.universities ?? []).filter((u) => isUniversityListed(u, presets)), packages: (site.packages ?? []).filter((p) => p.enabled) }
}
const courseInput = courseSaveBody
const groupInput = groupSaveBody
const videoInput = (v: Video) => ({
  teacherId: v.teacherId, courseId: v.courseId ?? null, title: v.title, description: v.description,
  // A browser-only `blob:` preview is never saved: without storage an uploaded file has no address at all.
  source: v.source.kind === 'link' ? { kind: 'link' as const, url: v.source.url } : { kind: 'upload' as const, key: v.source.file.name, url: storableUrl(v.source.file.previewUrl) ?? undefined },
  durationSec: v.durationSec, thumbnailUrl: storableUrl(v.thumbnailUrl), coverSeed: v.coverSeed, ...publishableInput(v),
})
const playlistInput = (p: Playlist) => ({ teacherId: p.teacherId, title: p.title, description: p.description, videoIds: p.videoIds, coverSeed: p.coverSeed, ...publishableInput(p) })
const resourceInput = (r: Resource) => ({
  teacherId: r.teacherId, courseId: r.courseId ?? null, title: r.title, description: r.description, kind: r.kind,
  file: r.file ? { name: r.file.name, size: r.file.size, mime: r.file.mime } : null, url: storableUrl(r.url), pages: r.pages ?? null, ...publishableInput(r),
})
/** A localized text as the API requires it, every language present (a self-registered profile starts with `{}`). */
const fullL = (l: { uz?: string; ru?: string; en?: string } | null | undefined) => ({ uz: l?.uz ?? '', ru: l?.ru ?? '', en: l?.en ?? '' })
/**
 * Profile payload for PATCH /manage/profile and the Super Admin routes. Only the Super Admin sends `centerId`, and only
 * a real one: a teacher's own save leaves it out (the API refuses null, and a self-registered teacher has no center yet).
 * Browser-only `blob:` previews never travel; uploaded images arrive here already as their storage address.
 */
const teacherInput = (t: Teacher, admin: boolean) => ({
  name: t.name, title: fullL(t.title), bio: fullL(t.bio), expertise: t.expertise, ...(admin && t.centerId ? { centerId: t.centerId } : {}), avatarSeed: t.avatarSeed, bannerTone: t.bannerTone,
  avatarUrl: storableUrl(t.avatarUrl), bannerUrl: storableUrl(t.bannerUrl), tagline: fullL(t.tagline), channelActive: t.channelActive, featured: t.featured ?? null,
})

/** API video → web shape (uploads carry a key + optional URL). */
const mapVideo = (v: Video & { source: { kind: string; url?: string; key?: string } }): Video => ({
  ...v,
  source: v.source.kind === 'upload' ? { kind: 'upload', file: { name: v.source.key ?? 'upload', size: 0, mime: 'video/*', previewUrl: v.source.url } } : { kind: 'link', url: v.source.url ?? '' },
})

type ApiOverview = {
  builder: { packageId: string | null; groupIds: string[]; meyosGrant: boolean }
  subscription: {
    id: string; packageId: string | null; status: string; groupIds: string[]; startedAt: string | null; currentPeriodStart: string | null; currentPeriodEnd: string | null; funding: { meyosGrant: boolean; courseIds: string[] }; amountMinor: string
    kind?: 'PERIOD' | 'LESSONS'; lessonsTotal?: number | null; lessonsUsed?: number; blocked?: boolean; blockReason?: 'period_ended' | 'lessons_exhausted' | null; graceEndsAt?: string | null
  } | null
  payments: PaymentSummary[]
}

export function createIlmoraStore(initial: InitialData): StoreApi<StoreState> {
  const { version: siteVersion = 1, permissions: _publicPermissions, ...publicSiteData } = initial.site
  void _publicPermissions
  // Whatever the server render passed in, the visitor starts with every switch off (Ж17); applyAuth loads the account's own.
  const site: SiteConfig = { ...publicSiteData, permissions: NO_PERMISSIONS }
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
  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* private mode */
    }
  }
  const readGuestSaved = (): string[] => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(GUEST_SAVED_KEY) : null
      const list: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === 'string'))] : []
    } catch {
      return []
    }
  }
  const writeGuestSaved = (ids: string[]) => {
    try {
      if (ids.length) localStorage.setItem(GUEST_SAVED_KEY, JSON.stringify(ids))
      else localStorage.removeItem(GUEST_SAVED_KEY)
    } catch {
      /* private mode */
    }
  }
  const readBundles = (): CartBundle[] => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CART_BUNDLES_KEY) : null
      const list: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(list)
        ? list.filter((b): b is CartBundle => !!b && typeof b.presetId === 'string' && Array.isArray(b.courseIds)).map((b) => ({ presetId: b.presetId, directionId: typeof b.directionId === 'string' ? b.directionId : undefined, courseIds: b.courseIds.filter((id): id is string => typeof id === 'string') }))
        : []
    } catch {
      return []
    }
  }
  const writeBundles = (bundles: CartBundle[]) => {
    try {
      if (bundles.length) localStorage.setItem(CART_BUNDLES_KEY, JSON.stringify(bundles))
      else localStorage.removeItem(CART_BUNDLES_KEY)
    } catch {
      /* private mode */
    }
  }

  // The workspace request in flight, shared by every RequireRole that asks while it loads.
  let workspaceLoading: Promise<unknown> | null = null
  // The account's own switches on their way (Ж17); the workspace load waits for them.
  let permissionsLoading: Promise<void> | null = null
  // The public content request in flight, keyed by who is asking; the answer for a newer account always wins over an older one.
  let contentLoading: { key: string; promise: Promise<void> } | null = null
  let contentSeq = 0
  let storageStatusLoading: Promise<boolean | null> | null = null
  return createStore<StoreState>()((set, get) => {
    const toast = (err: unknown) => get().notify(apiErrorText(err, get().lang), 'warn')
    const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } catch (err) {
        toast(err)
        throw err
      }
    }
    let saveSiteTimer: ReturnType<typeof setTimeout> | undefined
    // Site saves run one after another: a save fired while the previous one is still in flight would resend the same
    // version and the server would answer version_conflict to the admin's own edit.
    let siteSaveChain: Promise<void> = Promise.resolve()
    const packageTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const packagePatches = new Map<string, Partial<Package>>()
    const scheduleSiteSave = () => {
      if (get().role !== 'admin') return
      clearTimeout(saveSiteTimer)
      saveSiteTimer = setTimeout(() => {
        siteSaveChain = siteSaveChain.then(async () => {
          // The version in the server-rendered page comes from a cached public fetch and can be a minute old; the admin
          // workspace load (loadAdminPresets) brings the current one, so wait for it before the first save.
          if (workspaceLoading) await workspaceLoading.catch(() => undefined)
          // Only the settings loaded from the server go out, with the version that came with them: never the cached ones.
          if (!get().presetsLoaded) { get().notify(translate(get().lang, 'admin.siteNotLoaded'), 'warn'); return }
          const { packages: _p, ...data } = get().site
          void _p
          try {
            const r = await api<{ version: number }>('/admin/site', { method: 'PUT', body: { data, version: get().siteVersion } })
            set({ siteVersion: r.version })
          } catch (err) {
            if (!isApiError(err) || err.code !== 'version_conflict') { toast(err); return }
            // Someone else saved the settings meanwhile: their version (and its number) is loaded and the admin is told
            // that the last change did not go through — otherwise every next save would fail the same way.
            try {
              const { version, ...fresh } = await api<SiteConfig & { version: number }>('/admin/site')
              set({ site: fresh as SiteConfig, siteVersion: version, presetsLoaded: true })
              get().notify(translate(get().lang, 'admin.siteReloaded'), 'warn')
            } catch (reloadErr) {
              toast(reloadErr)
            }
          }
        })
      }, 800)
    }
    const patchMe = (fn: (st: Student) => Student) => set((s) => ({ students: s.students.map((st) => (st.id === s.currentStudentId ? fn(st) : st)) }))
    let draftTimer: ReturnType<typeof setTimeout> | undefined
    const syncDraft = () => {
      const me = get().students.find((x) => x.id === get().currentStudentId)
      if (!me) return
      // Signed out: the local draft is the visitor's cart. Signed in: the server draft is the only copy, so a stale
      // local one can never be merged back into the account later.
      if (get().auth.status !== 'authenticated') {
        writeDraft(me.builder)
        return
      }
      clearTimeout(draftTimer)
      draftTimer = setTimeout(() => {
        api('/student/subscription/draft', { method: 'PUT', body: { packageId: me.builder.packageId, groupIds: me.builder.groupIds, meyosGrant: me.builder.meyosGrant } }).then(() => clearDraft()).catch(toast)
      }, 500)
    }
    const applyAuth = (user: AuthUser | null) => {
      const role = roleOf(user)
      const currentDraft = readDraft() ?? { packageId: null, groupIds: [], meyosGrant: false }
      set((s) => ({
        auth: { status: user ? 'authenticated' : 'anonymous', user },
        role,
        currentStudentId: user?.id ?? GUEST_STUDENT_ID,
        currentTeacherId: user?.teacherProfileId ?? '',
        students: user
          ? upsertIn(s.students.filter((x) => x.id !== user.id && x.id !== GUEST_STUDENT_ID), { ...emptyStudent(user), builder: currentDraft })
          : [emptyGuestStudent(currentDraft, readGuestSaved())],
        workspaceLoaded: false,
        // Disabled presets are internal: drop them from memory on every sign-in/out; admins reload the full list.
        presetsLoaded: false,
        siteLoadFailed: false,
        permissionsStatus: user ? 'loading' : 'idle',
        // Ж17: the switches of the previous account (or the Super Admin's whole matrix) never outlive a sign-in/out.
        site: { ...(s.site.presets ? publicSite(s.site) : s.site), permissions: NO_PERMISSIONS },
      }))
      // The Super Admin gets the whole matrix with the full settings (loadAdminPresets); everyone else reads their own.
      permissionsLoading = user && role !== 'admin' ? loadOwnPermissions(user) : null
    }
    /**
     * The signed-in account's own switches (`GET /me/permissions`). One retry after a short pause; if that fails too the
     * switches stay off, the status is `error` and the account is told (the workspace offers to try again).
     */
    const loadOwnPermissions = async (user: AuthUser) => {
      const stillSignedIn = () => get().auth.user?.id === user.id
      let own: Partial<Permissions> | null = null
      for (let attempt = 0; attempt < 2 && !own; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, PERMISSIONS_RETRY_MS))
          if (!stillSignedIn()) return
        }
        try {
          own = (await api<Partial<Permissions>>('/me/permissions')) ?? {}
        } catch {
          // Offline demo accounts (no backend) use the sample switches of their own role.
          if (DEMO_LOGIN_ENABLED && session.token?.startsWith('demo-token-')) {
            const sample = (sampleData.site as unknown as SiteConfig).permissions
            own = { ...(user.roles.includes('TEACHER') ? { teacher: sample.teacher } : {}), ...(user.roles.includes('STUDENT') ? { student: sample.student } : {}) }
          }
        }
      }
      // Only for the account still signed in: an answer that arrives after a sign-out or a switch of account is dropped.
      if (!stillSignedIn()) return
      if (!own) {
        set({ permissionsStatus: 'error' })
        get().notify(translate(get().lang, 'perm.loadFailed'), 'warn')
        return
      }
      const loaded = own
      set((s) => ({ site: { ...s.site, permissions: ownPermissions(loaded) }, permissionsStatus: 'ready' }))
    }
    // The API's 403 password_change_required: the account still has the temporary password. Mark it, so the sign-in
    // card, the workspace gate and PasswordChangeRedirect show the change screen (the same as for the flag).
    // Browser only: the server renders without the visitor's session, and one module-level handler must not outlive a request.
    if (typeof window !== 'undefined') {
      setPasswordChangeRequiredHandler(() => {
        const user = get().auth.user
        if (user && !user.passwordChangeRequired) set({ auth: { status: 'authenticated', user: { ...user, passwordChangeRequired: true } } })
      })
    }
    /** Store the access token, apply the account and warm the student overview; used by every sign-in path. */
    const openSession = async (r: { accessToken: string; user: AuthUser }) => {
      session.set(r.accessToken)
      applyAuth(r.user)
      if (r.user.roles.includes('STUDENT')) await get().loadStudentOverview().catch(() => undefined)
      return r.user
    }
    const refreshWorkspace = async () => {
      const isAdmin = get().role === 'admin'
      // Fire presets alongside /manage/mine so the workspace is gated by the slowest request, not their sum.
      // The admin roster is no longer loaded here: the People screen fetches it paginated, overview totals come from /admin/stats.
      const minePromise = api<{ teacher: Teacher | null; courses: Course[]; videos: Video[]; playlists: Playlist[]; resources: Resource[]; subjects: Subject[] }>('/manage/mine')
      const presetsPromise = isAdmin ? get().loadAdminPresets().catch(() => undefined) : undefined
      // The teacher's switches decide what the studio lets them change: the workspace is ready only with them (Ж17).
      const ownPermissionsPromise = isAdmin ? undefined : permissionsLoading
      const mine = await minePromise
      if (ownPermissionsPromise) await ownPermissionsPromise
      publishSeatCounts(mine.courses.flatMap((c) => c.groups))
      set((s) => ({
        teachers: mine.teacher ? upsertIn(s.teachers, mine.teacher) : s.teachers,
        courses: get().role === 'admin' ? mine.courses : [...s.courses.filter((c) => !mine.courses.some((m) => m.id === c.id)), ...mine.courses],
        videos: mine.videos.map((v) => mapVideo(v as Video & { source: { kind: string; url?: string; key?: string } })),
        playlists: mine.playlists,
        resources: mine.resources,
        subjects: get().role === 'admin' ? mine.subjects : [...s.subjects.filter((x) => !mine.subjects.some((m) => m.id === x.id)), ...mine.subjects],
      }))
      // Presets were started above (not fatal: without them the preset editor keeps waiting and site saves leave presets alone).
      if (isAdmin) await presetsPromise
      set({ workspaceLoaded: true })
    }

    return {
      ...initial.catalog,
      site,
      siteVersion,
      videos: [],
      playlists: [],
      resources: [],
      // Empty on purpose: reading localStorage here would make the first client render differ from the server HTML (hydration
      // mismatch). StoreProvider calls hydrateGuest() after mount instead.
      students: [emptyGuestStudent()],
      sessions: [],
      attendance: [],
      lang: initial.lang,
      role: 'visitor',
      currentTeacherId: '',
      currentStudentId: GUEST_STUDENT_ID,
      toasts: [],
      auth: { status: 'idle', user: null },
      workspaceLoaded: false,
      guestHydrated: false,
      presetsLoaded: false,
      siteLoadFailed: false,
      permissionsStatus: 'idle',
      myPayments: [],
      cartBundles: [],
      sessionQr: {},
      notifications: [],
      unreadCount: 0,
      contentStatus: 'idle',
      storageConfigured: null,

      // ── UI ──
      setLang: (lang) => set({ lang }),
      setCurrentTeacher: (id) => set({ currentTeacherId: id }),
      setCurrentStudent: (id) => set({ currentStudentId: id }),
      notify: (text, tone = 'ok', link) => {
        const id = toastSeq++
        set((s) => ({ toasts: [...s.toasts, { id, text, tone, link }] }))
        // A toast with a link stays a little longer, so there is time to follow it.
        setTimeout(() => get().dismissToast(id), link ? 6500 : 3600)
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      // ── auth ──
      bootstrap: async () => {
        if (get().auth.status !== 'idle') return
        set({ auth: { status: 'loading', user: null } })
        // Only call /auth/refresh when the API left its session flag cookie; anonymous visitors cause no 401 noise.
        const hasSession = typeof document !== 'undefined' && /(?:^|;\s*)ilmora_session=1(?:;|$)/.test(document.cookie)
        // №19: too many requests right now (e.g. a class on one Wi-Fi) — the cookie is still valid. Keep waiting on
        // «checking», say «повторите позже» and try again by itself after the pause the API asked for; never sign out.
        const retryLater = () => {
          get().notify(apiErrorText(new ApiError(429, REFRESH_LIMITED, ''), get().lang), 'warn')
          setTimeout(() => { set({ auth: { status: 'idle', user: null } }); void get().bootstrap() }, Math.min(60, Math.max(5, refreshRetryAfterSeconds())) * 1000)
        }
        const outcome = session.token ? 'ok' : hasSession ? await refreshSessionOutcome() : 'denied'
        if (outcome === 'limited') { retryLater(); return }
        if (outcome !== 'ok') { applyAuth(null); return }
        try {
          const user = await api<AuthUser>('/auth/me')
          applyAuth(user)
          if (user.roles.includes('STUDENT')) await get().loadStudentOverview()
        } catch (err) {
          if (err instanceof ApiError && err.status === 429) { retryLater(); return }
          session.set(null)
          applyAuth(null)
        }
      },
      register: (input) => api<{ accessToken: string; user: AuthUser }>('/auth/register', { method: 'POST', body: { ...input, lang: get().lang }, credentials: true, auth: false }).then(openSession),
      login: (login, password) =>
        api<{ accessToken: string; user: AuthUser } | MfaChallengeDto>('/auth/login', { method: 'POST', body: { login, password }, credentials: true, auth: false })
          .then<AuthUser | MfaChallengeDto>((r) => (isMfaChallenge(r) ? r : openSession(r))),
      mfaSetup: (challenge) => api<MfaSetupDto>('/auth/mfa/setup', { method: 'POST', body: { challenge }, auth: false }),
      mfaConfirm: async (challenge, code) => {
        const r = await api<{ accessToken: string; user: AuthUser; recoveryCodes: string[] }>('/auth/mfa/confirm', { method: 'POST', body: { challenge, code }, credentials: true, auth: false })
        return { user: await openSession(r), recoveryCodes: r.recoveryCodes }
      },
      mfaVerify: (challenge, code) => api<{ accessToken: string; user: AuthUser }>('/auth/mfa/verify', { method: 'POST', body: { challenge, code }, credentials: true, auth: false }).then(openSession),
      changePassword: (currentPassword, newPassword) => api<{ accessToken: string; user: AuthUser }>('/auth/password', { method: 'POST', body: { currentPassword, newPassword }, credentials: true }).then(openSession),
      requestPasswordCode: (phone) => api<{ expiresInSeconds: number; devCode?: string }>('/auth/otp/request', { method: 'POST', body: { phone, lang: get().lang }, auth: false }),
      resetPasswordBySms: (phone, code, newPassword) =>
        api<{ accessToken: string; user: AuthUser }>('/auth/password/reset', { method: 'POST', body: { phone, code, newPassword }, credentials: true, auth: false }).then(openSession),
      loginAsDemo: async (role, customUser) => {
        if (!DEMO_LOGIN_ENABLED) throw new Error('demo_login_disabled')
        const id = role === 'TEACHER' ? 't-dilnoza' : 's-aziz'
        const demoUser: AuthUser = {
          id,
          login: role === 'TEACHER' ? 'ustoz.dilnoza' : 'aziz.student',
          phone: customUser?.phone ?? null,
          displayName: customUser?.displayName || (role === 'TEACHER' ? 'Dilnoza Karimova (Demo)' : 'Aziz Qodirov (Demo)'),
          district: 'Yunusobod',
          preferredLang: get().lang,
          reminders: true,
          roles: [role],
          centerId: null,
          teacherProfileId: role === 'TEACHER' ? 't-dilnoza' : null,
          offerAcceptedAt: new Date().toISOString(),
          offerVersion: OFFER_VERSION,
          consentAt: new Date().toISOString(),
          marketing: false,
          ...customUser,
        }
        return openSession({ accessToken: `demo-token-${id}`, user: demoUser })
      },
      giveConsent: async (input) => {
        try {
          const user = await api<AuthUser>('/auth/consent', { method: 'POST', body: input })
          set((s) => ({ auth: { ...s.auth, user } }))
          return user
        } catch (err) {
          const curr = get().auth.user
          // Only offline demo accounts (no backend) may record consent locally. A real account must get the server's
          // confirmation: if /auth/consent failed, re-throw so the gate shows the error and consent is NOT falsely
          // marked as given when the server never stored it (Ж11).
          if (curr && (curr.id.startsWith('s-') || curr.id.startsWith('t-') || curr.id.startsWith('demo-'))) {
            const updated: AuthUser = {
              ...curr,
              offerAcceptedAt: new Date().toISOString(),
              offerVersion: OFFER_VERSION,
              consentAt: new Date().toISOString(),
              marketing: input.marketing ?? false,
            }
            set((s) => ({ auth: { ...s.auth, user: updated } }))
            return updated
          }
          throw err
        }
      },
      logout: async () => {
        await api('/auth/logout', { method: 'POST', credentials: true }).catch(() => undefined)
        session.set(null)
        applyAuth(null)
        writeBundles([])
        set({ sessions: [], attendance: [], myPayments: [], notifications: [], unreadCount: 0, cartBundles: [] })
      },
      ensureWorkspace: async () => {
        // The workspace (own courses, videos, people) exists for teachers and admins only; concurrent callers share one load.
        if (get().workspaceLoaded || get().role === 'visitor' || get().role === 'student' || get().role === 'ministry' || get().role === 'institution' || get().role === 'company') return
        workspaceLoading ??= guard(refreshWorkspace).finally(() => { workspaceLoading = null })
        await workspaceLoading
      },
      hydrateGuest: () => {
        set({ cartBundles: readBundles() })
        if (get().auth.status === 'authenticated') return set({ guestHydrated: true })
        const draft = readDraft()
        const saved = readGuestSaved()
        if (!draft && saved.length === 0) return set({ guestHydrated: true })
        set((s) => ({
          guestHydrated: true,
          students: s.students.map((x) =>
            x.id !== GUEST_STUDENT_ID
              ? x
              : { ...x, builder: x.builder.packageId || x.builder.groupIds.length > 0 ? x.builder : (draft ?? x.builder), savedCourseIds: x.savedCourseIds.length > 0 ? x.savedCourseIds : saved },
          ),
        }))
      },
      loadAdminPresets: async () => {
        // The page was rendered from a cached public read (up to a minute old, without the disabled presets, universities and
        // packages). The admin works on the current settings: all of them and their version, both from this one answer.
        // Ж17: the answer carries the whole matrix and the internal presets — only for the admin who asked: an answer that
        // arrives after a sign-out (or a switch of account) is dropped, never written into a visitor's store.
        const who = get().auth.user?.id
        const asRole = get().role
        const sameAdmin = () => get().role === asRole && get().auth.user?.id === who
        try {
          const { version, ...fresh } = await api<SiteConfig & { version: number }>('/admin/site')
          if (!sameAdmin()) return
          set({ site: fresh as SiteConfig, siteVersion: version, presetsLoaded: true, siteLoadFailed: false, permissionsStatus: 'ready' })
        } catch (err) {
          if (!sameAdmin()) return
          set({ presetsLoaded: false, siteLoadFailed: true, permissionsStatus: 'error' })
          throw err
        }
      },
      loadMyPermissions: async () => {
        const user = get().auth.user
        if (!user) return
        if (get().role === 'admin') return get().loadAdminPresets().catch(() => undefined)
        set({ permissionsStatus: 'loading' })
        permissionsLoading = loadOwnPermissions(user)
        await permissionsLoading
      },
      loadStudentOverview: async () => {
        const o = await api<ApiOverview>('/student/subscription')
        // The local draft only ever holds what was chosen while signed out. Merge it into the account's draft
        // (the account wins on conflicts, duplicates are impossible) and drop it once the server has the result.
        const guestCart = readDraft()
        const hasServerDraft = !!o.builder.packageId || o.builder.groupIds.length > 0
        let builder: Student['builder'] | null = hasServerDraft ? o.builder : null
        let pushDraft = false
        if (guestCart && (guestCart.packageId || guestCart.groupIds.length > 0)) {
          const packageId = o.builder.packageId ?? guestCart.packageId
          const limit = get().site.packages.find((p) => p.id === packageId)?.maxCourses ?? MAX_CART_COURSES
          const me = get().currentStudentId
          const merged = mergeCartGroups(o.builder.groupIds, guestCart.groupIds, get().courses.flatMap((c) => c.groups), {
            limit,
            isFull: (g) => enrolledCount(get().students, g.id, me) >= g.capacity,
          })
          builder = { packageId, groupIds: merged.groupIds, meyosGrant: hasServerDraft ? o.builder.meyosGrant : guestCart.meyosGrant }
          pushDraft = merged.groupIds.length !== o.builder.groupIds.length || packageId !== o.builder.packageId || builder.meyosGrant !== o.builder.meyosGrant
          if (merged.dropped.length > 0) get().notify(translate(get().lang, 'cart.mergeDropped'), 'warn')
          if (!pushDraft) clearDraft()
        }
        patchMe((st) => ({
          ...st,
          subscription: o.subscription
            ? {
                packageId: o.subscription.packageId, groupIds: o.subscription.groupIds, status: o.subscription.status === 'ACTIVE' || o.subscription.status === 'PAST_DUE' ? 'active' : 'none', startedAt: o.subscription.startedAt ?? undefined, renewsAt: o.subscription.currentPeriodEnd ?? undefined, funding: o.subscription.funding, amountMinor: o.subscription.amountMinor,
                kind: o.subscription.kind ?? 'PERIOD', lessonsTotal: o.subscription.lessonsTotal ?? null, lessonsUsed: o.subscription.lessonsUsed ?? 0, blocked: !!o.subscription.blocked, blockReason: o.subscription.blockReason ?? null, graceEndsAt: o.subscription.graceEndsAt ?? null,
              }
            : { packageId: null, groupIds: [], status: 'none' },
          builder: builder ?? st.builder,
        }))
        set({ myPayments: o.payments })
        if (pushDraft) syncDraft()
        const saved: { courseIds: string[]; teacherIds: string[] } = await api<{ courseIds: string[]; teacherIds: string[] }>('/student/saved').catch(() => ({ courseIds: [], teacherIds: [] }))
        // Favorites saved while signed out join the account's list without duplicates; ids that are no longer in
        // the catalog are discarded, and any that fail to upload stay local for the next sign-in.
        const guestSaved = readGuestSaved().filter((id) => !saved.courseIds.includes(id) && get().courses.some((c) => c.id === id))
        patchMe((st) => ({ ...st, savedCourseIds: [...saved.courseIds, ...guestSaved], savedTeacherIds: saved.teacherIds }))
        if (readGuestSaved().length > 0) {
          const results = await Promise.allSettled(guestSaved.map((id) => api('/student/saved', { method: 'PUT', body: { kind: 'course', itemId: id, saved: true } })))
          const failed = guestSaved.filter((_, i) => results[i].status === 'rejected')
          writeGuestSaved(failed)
          if (failed.length > 0) patchMe((st) => ({ ...st, savedCourseIds: st.savedCourseIds.filter((id) => !failed.includes(id)) }))
        }
      },
      loadGroupDetail: async (groupId) => {
        // Center administrators read their groups through the center API; teachers and the Super Admin through the studio API.
        const d = await guard(() => api<{ group: Course['groups'][number]; roster: { id: string; displayName: string; district: string | null; packageId: string | null; since: string }[]; sessions: (LessonSession & { records: { studentId: string; status: string; method: string; checkedInAt: string }[] })[] }>(`${get().role === 'center' ? '/center' : '/manage'}/groups/${groupId}`))
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
          const records: AttendanceRecord[] = d.sessions.flatMap((ses) => ses.records.map((r) => ({ id: `att-${ses.id}-${r.studentId}`, sessionId: ses.id, studentId: r.studentId, checkedInAt: r.checkedInAt, method: r.method as AttendanceRecord['method'], status: r.status })))
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
      loadPublicContent: async () => {
        // One request per account; when the account changes while a request is still running, only the newest answer lands.
        const key = `${get().role}:${get().auth.user?.id ?? ''}`
        if (contentLoading?.key === key) return contentLoading.promise
        const seq = ++contentSeq
        set({ contentStatus: 'loading' })
        const promise = api<{ videos: Video[]; playlists: Playlist[]; resources: Resource[] }>('/public/content')
          .then((c) => {
            if (seq !== contentSeq) return
            set({ videos: c.videos.map((v) => mapVideo(v as Video & { source: { kind: string; url?: string; key?: string } })), playlists: c.playlists, resources: c.resources, contentStatus: 'ready' })
          })
          .catch(() => { if (seq === contentSeq) set({ contentStatus: 'ready' }) })
          .finally(() => { if (contentLoading?.promise === promise) contentLoading = null })
        contentLoading = { key, promise }
        return promise
      },
      ensureStorageStatus: async () => {
        const known = get().storageConfigured
        if (known !== null) return known
        // When the question itself fails the control stays usable: the upload attempt reports what is wrong.
        storageStatusLoading ??= fetchStorageStatus()
          .catch(() => true)
          .then((configured) => { set({ storageConfigured: configured }); return configured })
          .finally(() => { storageStatusLoading = null })
        return storageStatusLoading
      },
      setStorageConfigured: (configured) => set({ storageConfigured: configured }),

      // ── site ──
      patchSite: (fn) => {
        // Before the current settings are loaded (or when that failed) an edit would be saved over them: refuse it.
        if (get().role === 'admin' && !get().presetsLoaded) { get().notify(translate(get().lang, 'admin.siteNotLoaded'), 'warn'); return }
        set((s) => ({ site: fn(s.site) }))
        scheduleSiteSave()
      },
      savePackage: (id, patch) => {
        set((s) => ({ site: { ...s.site, packages: s.site.packages.map((p) => (p.id === id ? { ...p, ...patch } : p)) } }))
        if (get().role !== 'admin') return
        // Typing in a field saves once it pauses; changes to one package are sent together.
        packagePatches.set(id, { ...packagePatches.get(id), ...patch })
        clearTimeout(packageTimers.get(id))
        packageTimers.set(id, setTimeout(() => {
          const { name, description, perks, maxCourses, enabled, highlight, accessKind, periodDays, lessonCount } = packagePatches.get(id) ?? {}
          packagePatches.delete(id)
          api(`/admin/packages/${id}`, { method: 'PATCH', body: { name, description, perks, maxCourses, enabled, highlight, accessKind, periodDays, lessonCount } }).catch(toast)
        }, 700))
      },
      addPackage: async () => {
        await guard(async () => {
          const blank = { uz: '', ru: '', en: '' }
          const code = `pkg-${Math.random().toString(36).slice(2, 10)}`
          const created = await api<{ id: string }>('/admin/packages', { method: 'POST', body: { code, name: blank, description: blank, perks: [], maxCourses: 4, enabled: false, highlight: false, sortOrder: get().site.packages.length } })
          set((s) => ({ site: { ...s.site, packages: [...s.site.packages, { id: created.id, name: blank, description: blank, perks: [], maxCourses: 4, enabled: false, highlight: false }] } }))
        })
      },
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
          if (existing) saved = await api<Course>(`/manage/courses/${c.id}`, { method: 'PATCH', body: courseInput(c, get().role === 'admin') })
          else saved = await api<Course>('/manage/courses', { method: 'POST', body: courseInput(c, get().role === 'admin') })
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
        const isAdmin = get().role === 'admin'
        const exists = get().teachers.some((x) => x.id === t.id)
        const path = isAdmin
          ? (exists ? `/admin/teachers/${t.id}` : '/admin/teachers')
          : `/manage/profile`
        const method = isAdmin && !exists ? 'POST' : 'PATCH'
        const saved = await guard(() => api<Teacher>(path, { method, body: teacherInput(t, isAdmin) }))
        set((s) => ({
          teachers: upsertIn(s.teachers.filter((x) => x.id !== t.id), saved),
          auth: s.auth.user && s.currentTeacherId === t.id
            ? { ...s.auth, user: { ...s.auth.user, displayName: saved.name } }
            : s.auth,
        }))
      },
      removeTeacher: async (id) => { await guard(() => api(`/admin/teachers/${id}`, { method: 'DELETE' })); set((s) => ({ teachers: s.teachers.filter((x) => x.id !== id) })) },
      upsertSubject: async (sub) => {
        const body = { teacherId: sub.teacherId, name: sub.name, description: sub.description }
        const saved = await guard(() => (get().subjects.some((x) => x.id === sub.id) ? api<Subject>(`/manage/subjects/${sub.id}`, { method: 'PUT', body }) : api<Subject>('/manage/subjects', { method: 'POST', body })))
        set((s) => ({ subjects: upsertIn(s.subjects.filter((x) => x.id !== sub.id), saved) }))
      },
      removeSubject: async (id) => { await guard(() => api(`/manage/subjects/${id}`, { method: 'DELETE' })); set((s) => ({ subjects: s.subjects.filter((x) => x.id !== id), courses: s.courses.map((c) => (c.subjectId === id ? { ...c, subjectId: undefined } : c)) })) },
      upsertCenter: async (c) => {
        const body = { name: c.name, kind: c.kind, district: c.district, description: c.description, tone: c.tone }
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
      deactivateStudent: async (id, roles) => {
        // The roles endpoint replaces the whole list, so the current roles are sent back unchanged (a teacher or center
        // administrator who is also a student keeps those roles); Super Admin is owner-only and never sent.
        const kept = roles.filter((r) => r !== 'PLATFORM_ADMIN')
        await guard(() => api(`/admin/users/${id}/roles`, { method: 'PUT', body: { roles: kept.length ? kept : ['STUDENT'], isActive: false, reason: 'Blocked from the admin people screen' } }))
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
        // No package selected is a custom selection (any number of courses up to MAX_CART_COURSES); a package id
        // that no longer exists is still rejected.
        const pkg = s.site.packages.find((p) => p.id === st.builder.packageId)
        if (st.builder.packageId && !pkg) return { ok: false, reason: 'no-package' }
        if (pkg && !pkg.enabled) return { ok: false, reason: 'disabled' }
        const limit = pkg?.maxCourses ?? MAX_CART_COURSES
        const allGroups = s.courses.flatMap((c) => c.groups)
        const target = allGroups.find((g) => g.id === groupId)
        if (!target) return { ok: false, reason: 'no-package' }
        if (enrolledCount(s.students, groupId, studentId) >= target.capacity) return { ok: false, reason: 'full' }
        const current = st.builder.groupIds.map((id) => allGroups.find((g) => g.id === id)).filter(Boolean) as typeof allGroups
        const sameCourse = current.find((g) => g.courseId === target.courseId)
        const others = sameCourse ? current.filter((g) => g.courseId !== target.courseId) : current
        if (!sameCourse && others.length >= limit) return { ok: false, reason: 'limit' }
        const clash = others.find((g) => overlaps(g, target))
        if (clash) return { ok: false, reason: 'conflict', conflictWith: clash.courseId }
        set((state) => ({ students: state.students.map((x) => (x.id === studentId ? { ...x, builder: { ...x.builder, groupIds: [...others.map((g) => g.id), groupId] } } : x)) }))
        syncDraft()
        return { ok: true }
      },
      removeBuilderCourse: (studentId, courseId) => {
        const allGroups = get().courses.flatMap((c) => c.groups)
        set((s) => ({ students: s.students.map((st) => (st.id === studentId ? { ...st, builder: { ...st.builder, groupIds: st.builder.groupIds.filter((id) => allGroups.find((g) => g.id === id)?.courseId !== courseId) } } : st)) }))
        // A package whose last course left the cart is gone from it as well.
        const inCart = new Set(get().students.find((x) => x.id === studentId)?.builder.groupIds.map((id) => allGroups.find((g) => g.id === id)?.courseId))
        const bundles = get().cartBundles.filter((b) => b.courseIds.some((id) => inCart.has(id)))
        if (bundles.length !== get().cartBundles.length) { set({ cartBundles: bundles }); writeBundles(bundles) }
        syncDraft()
      },
      addPresetToCart: (studentId, preset, opts = {}) => {
        const s = get()
        const st = s.students.find((x) => x.id === studentId)
        if (!st) return { ok: false, reason: 'unavailable' }
        const { toAdd, inCart } = presetCartPlan(preset, s.courses, st.builder.groupIds, opts.chosenOptional)
        if (toAdd.length + inCart.length === 0) return { ok: false, reason: 'unavailable' }
        const allGroups = s.courses.flatMap((c) => c.groups)
        const current = st.builder.groupIds.map((id) => allGroups.find((g) => g.id === id)).filter((g): g is (typeof allGroups)[number] => !!g)
        const total = current.length + toAdd.length
        if (total > MAX_CART_COURSES) return { ok: false, reason: 'limit' }
        const pick = pickPresetGroups(toAdd, current, (g) => enrolledCount(s.students, g.id, studentId) >= g.capacity)
        if (!pick.ok) return { ok: false, reason: pick.reason, courseId: pick.courseId, conflictWith: pick.conflictWith }
        // Flex and Winx take an exact number of courses. When the cart no longer matches it, the selection becomes a custom
        // one, so the package can go to checkout right away (the price is the courses' own either way).
        const pkg = s.site.packages.find((p) => p.id === st.builder.packageId)
        const switchedFrom = st.builder.packageId && (!pkg?.enabled || total !== pkg.maxCourses) ? st.builder.packageId : null
        const bundle: CartBundle = { presetId: preset.id, directionId: opts.directionId, courseIds: [...inCart, ...toAdd].map((c) => c.id) }
        const bundles = [...s.cartBundles.filter((b) => b.presetId !== preset.id), bundle]
        set((state) => ({
          cartBundles: bundles,
          students: state.students.map((x) => (x.id === studentId ? { ...x, builder: { ...x.builder, packageId: switchedFrom ? null : x.builder.packageId, groupIds: [...x.builder.groupIds, ...pick.groups.map((g) => g.id)] } } : x)),
        }))
        writeBundles(bundles)
        syncDraft()
        return { ok: true, added: toAdd.length, switchedFrom }
      },
      removeCartBundle: (studentId, presetId) => {
        const s = get()
        const bundle = s.cartBundles.find((b) => b.presetId === presetId)
        if (!bundle) return
        const others = s.cartBundles.filter((b) => b !== bundle)
        const keep = new Set(others.flatMap((b) => b.courseIds))
        const drop = new Set(bundle.courseIds.filter((id) => !keep.has(id)))
        const allGroups = s.courses.flatMap((c) => c.groups)
        set((state) => ({
          cartBundles: others,
          students: state.students.map((x) => (x.id === studentId ? { ...x, builder: { ...x.builder, groupIds: x.builder.groupIds.filter((id) => !drop.has(allGroups.find((g) => g.id === id)?.courseId ?? '')) } } : x)),
        }))
        writeBundles(others)
        syncDraft()
      },
      clearBuilder: (studentId) => {
        set((state) => ({ cartBundles: [], students: state.students.map((x) => (x.id === studentId ? { ...x, builder: { ...x.builder, groupIds: [] } } : x)) }))
        writeBundles([])
        syncDraft()
      },
      checkout: async (provider) => {
        const me = get().students.find((x) => x.id === get().currentStudentId)
        if (!me) throw new Error('Not signed in')
        await guard(() => api('/student/subscription/draft', { method: 'PUT', body: { packageId: me.builder.packageId, groupIds: me.builder.groupIds, meyosGrant: me.builder.meyosGrant } }))
        // A free selection is activated at once and comes back without a provider page (url null).
        return guard(() => api<{ url: string | null; paymentId: string; free?: boolean }>('/student/subscription/checkout', { method: 'POST', body: { provider, lang: get().lang } }))
      },
      renewSubscription: async (_studentId, provider = 'PAYME') => {
        // Nothing is renewed here: the API opens a payment and the browser goes to the provider's page to pay for it.
        const r = await guard(() => api<{ url: string | null; paymentId: string }>('/student/subscription/renew', { method: 'POST', body: { provider, lang: get().lang } }))
        if (typeof window === 'undefined') return
        // A free renewal needs no provider page: the return page shows it paid and reloads the cabinet.
        if (!r.url) { window.location.href = `/${get().lang}/payments/${r.paymentId}/return`; return }
        get().notify(translate(get().lang, 'checkout.redirecting'))
        window.location.href = r.url
      },
      toggleSavedCourse: (studentId, courseId) => {
        const me = get().students.find((x) => x.id === studentId)
        const saved = !me?.savedCourseIds.includes(courseId)
        set((s) => ({ students: s.students.map((x) => (x.id === studentId ? { ...x, savedCourseIds: saved ? [...x.savedCourseIds, courseId] : x.savedCourseIds.filter((c) => c !== courseId) } : x)) }))
        if (get().auth.status === 'authenticated') api('/student/saved', { method: 'PUT', body: { kind: 'course', itemId: courseId, saved } }).catch(toast)
        else if (studentId === GUEST_STUDENT_ID) writeGuestSaved(get().students.find((x) => x.id === studentId)?.savedCourseIds ?? [])
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
      centerCheckIn: (code, input) => guard(() => api<CenterCheckInOutcome>(`/attendance/centers/${encodeURIComponent(code)}/check-in`, { method: 'POST', body: input })),

      // ── notifications ──
      loadNotifications: async () => {
        const r = await api<{ items: AppNotification[]; unreadCount: number }>('/notifications?limit=30')
        set({ notifications: r.items, unreadCount: r.unreadCount })
      },
      markNotificationsRead: async (ids) => {
        const r = await guard(() => api<{ unreadCount: number }>('/notifications/read', { method: 'POST', body: ids ? { ids } : { all: true } }))
        const at = new Date().toISOString()
        set((s) => ({ unreadCount: r.unreadCount, notifications: s.notifications.map((n) => (!n.readAt && (!ids || ids.includes(n.id)) ? { ...n, readAt: at } : n)) }))
      },

      // ── teacher attendance ──
      generateGroupSessions: async (groupId, days = 28) => {
        const r = await guard(() => api<{ created: number }>(`${get().role === 'center' ? '/center' : '/manage'}/groups/${groupId}/sessions/generate`, { method: 'POST', body: { days } }))
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
      refreshSessionQr: async (sessionId) => {
        const r = await guard(() => api<{ session: LessonSession; token: string; url: string }>(`/teacher/sessions/${sessionId}/qr`, { method: 'POST', body: {} }))
        if (r?.token && r?.url) {
          set((s) => ({
            sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, ...r.session, token: r.token } : x)),
            sessionQr: { ...s.sessionQr, [sessionId]: { token: r.token, url: r.url } },
          }))
          return r
        }
        return null
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
          set((s) => ({ attendance: upsertIn(s.attendance.filter((a) => !(a.sessionId === r.sessionId && a.studentId === r.studentId)), { id: `att-${r.sessionId}-${r.studentId}`, sessionId: r.sessionId, studentId: r.studentId, checkedInAt: r.checkedInAt, method: r.method as AttendanceRecord['method'], status: r.status }) }))
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

/** One store per request on the server; in the browser one for the whole visit (it outlives the provider's remounts). */
function storeFor(initial: InitialData): StoreApi<StoreState> {
  if (typeof window === 'undefined') return createIlmoraStore(initial)
  browserStore ??= createIlmoraStore(initial)
  return browserStore
}

export function StoreProvider({ initial, children }: { initial: InitialData; children: ReactNode }) {
  const [store] = useState(() => storeFor(initial))
  useEffect(() => {
    if (store.getState().lang !== initial.lang) store.setState({ lang: initial.lang })
  }, [store, initial.lang])
  useEffect(() => {
    store.getState().hydrateGuest()
    void store.getState().bootstrap()
  }, [store])
  useEffect(() => {
    // Visitors, students and centers read the public content lists (teachers and admins get theirs with the workspace);
    // every sign-in or sign-out reloads them, so what one account could see never lingers in the next one's lists.
    let seen = ''
    const sync = (s: StoreState) => {
      if (s.auth.status !== 'anonymous' && s.auth.status !== 'authenticated') return
      const key = `${s.role}:${s.auth.user?.id ?? ''}`
      if (key === seen) return
      seen = key
      if (s.role !== 'teacher' && s.role !== 'admin') void s.loadPublicContent()
    }
    sync(store.getState())
    return store.subscribe(sync)
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
