// ─────────────────────────────────────────────────────────────────────────────
// ILMORA domain types. Everything the store persists is described here.
// Structured so a future server can own authorization: every content item
// carries status + visibility + audience, and access checks live in lib/access.
// ─────────────────────────────────────────────────────────────────────────────

export type Lang = 'uz' | 'ru' | 'en'
export type L = Record<Lang, string>

export type Role = 'visitor' | 'student' | 'teacher' | 'admin'

export type Status = 'draft' | 'published' | 'archived'
export type Visibility = 'public' | 'private'

export interface Audience {
  studentIds: string[]
  groupIds: string[]
}

export interface Publishable {
  status: Status
  visibility: Visibility
  audience: Audience
  featured: boolean
  updatedAt: string
  /** Teacher without direct-publish rights asked Super Admin to review this draft. */
  reviewRequested?: boolean
}

export interface UploadMeta {
  name: string
  size: number
  mime: string
  /** Transient object URL; not persisted. Lost on reload. */
  previewUrl?: string
}

export interface Center {
  id: string
  /** URL-friendly id (API); absent in local sample data */
  slug?: string
  name: string
  district: L
  description: L
  tone: string // hex accent used in generated covers
}

export interface Category {
  id: string
  slug?: string
  name: L
  glyph: string
}

export interface Subject {
  id: string
  teacherId: string
  name: L
  description: L
}

export interface Group {
  id: string
  courseId: string
  name: string
  /** 0 = Monday … 6 = Sunday */
  days: number[]
  start: string // "18:00"
  end: string // "19:30"
  room: string
  /** Maximum number of enrolled students (teacher-defined, positive integer). Enrollment is derived from student subscriptions. */
  capacity: number
  /** Seats taken (active + pending holds), supplied by the API */
  enrolled?: number
}

export type Level = 'beginner' | 'intermediate' | 'advanced'

export interface Course extends Publishable {
  id: string
  slug?: string
  title: L
  categoryId: string
  centerId: string
  teacherId: string
  subjectId?: string
  summary: L
  description: L
  curriculum: L[]
  level: Level
  durationMonths: number
  /** Monthly price in Uzbek so‘m */
  price: number
  coverSeed: number
  imageUrl?: string
  imageUpload?: UploadMeta
  groups: Group[]
  /** Course may be funded through the Meyos grant (a funding selection shown at enrollment, not a payment method) */
  meyosGrant?: boolean
}

export type VideoSource =
  | { kind: 'link'; url: string }
  | { kind: 'upload'; file: UploadMeta }

export interface Video extends Publishable {
  id: string
  teacherId: string
  courseId?: string
  title: L
  description: L
  source: VideoSource
  durationSec: number
  thumbnailUpload?: UploadMeta
  thumbnailUrl?: string
  coverSeed: number
}

export interface Playlist extends Publishable {
  id: string
  teacherId: string
  title: L
  description: L
  videoIds: string[]
  coverSeed: number
}

export type ResourceKind = 'pdf' | 'doc' | 'sheet' | 'link' | 'other'

export interface Resource extends Publishable {
  id: string
  teacherId: string
  courseId?: string
  title: L
  description: L
  kind: ResourceKind
  file?: UploadMeta
  url?: string
  pages?: number
}

export interface Teacher {
  id: string
  slug?: string
  name: string
  title: L
  bio: L
  expertise: string[]
  /** Null for self-registered teachers until an admin assigns a center. */
  centerId: string | null
  avatarSeed: number
  bannerTone: string
  avatarUpload?: UploadMeta
  bannerUpload?: UploadMeta
  featured?: { type: 'course' | 'playlist'; id: string }
  tagline: L
  channelActive: boolean
}

export interface StudentProfile {
  displayName: string
  district: string
  preferredLang: Lang
  reminders: boolean
}

export type PaymentMethodId = 'card' | 'payme' | 'click' | 'cash'

export interface PaymentMethod {
  id: PaymentMethodId
  enabled: boolean
}

export interface PaymentConfig {
  /** Only enabled methods are offered at checkout; extra methods can be switched on later without code changes to the flow */
  methods: PaymentMethod[]
}

export interface Subscription {
  packageId: string | null
  groupIds: string[]
  status: 'none' | 'active'
  startedAt?: string
  renewsAt?: string
  /** Simulated payment record — the demo never collects or stores card numbers or CVVs */
  payment?: { method: PaymentMethodId; simulated: true; confirmedAt: string }
  /** Separate grant-funding selection, not a payment method; never changes the amount due or marks anything as paid */
  funding?: { meyosGrant: boolean; courseIds: string[] }
}

export interface Student {
  id: string
  profile: StudentProfile
  subscription: Subscription
  savedCourseIds: string[]
  savedTeacherIds: string[]
  /** Draft selections in the package builder (before activation) */
  builder: { packageId: string | null; groupIds: string[]; meyosGrant: boolean }
}

export type SessionStatus = 'scheduled' | 'completed' | 'cancelled'

/** One scheduled occurrence of a group lesson. Each session has its own attendance token/QR. */
export interface LessonSession {
  id: string
  groupId: string
  courseId: string
  /** ISO date, e.g. 2026-10-07 */
  date: string
  start: string
  end: string
  status: SessionStatus
  attendanceOpen: boolean
  /** Per-session token embedded in the attendance link (client never sees the server's stored hash). */
  token: string
  /** Absolute instants supplied by the API (UTC ISO strings). */
  startsAt?: string
  endsAt?: string
  openedAt?: string
  closedAt?: string
}

export interface AttendanceRecord {
  id: string
  sessionId: string
  studentId: string
  checkedInAt: string
  method: 'qr' | 'manual'
  /** present (default) | absent | excused — set by teacher corrections */
  status?: string
}

export interface Package {
  id: string
  name: L
  maxCourses: number
  description: L
  perks: L[]
  enabled: boolean
  highlight: boolean
}

export type SectionType =
  | 'hero'
  | 'packages'
  | 'featuredCourses'
  | 'categories'
  | 'howItWorks'
  | 'studio3d'
  | 'furnitureStory'
  | 'teachers'
  | 'centers'
  | 'faq'
  | 'centerCta'
  | 'announcement'
  | 'richText'
  | 'steps'
  | 'inquiryForm'
  | 'marquee'

export interface Section {
  id: string
  type: SectionType
  enabled: boolean
  title: L
  subtitle: L
  body?: L
  imageUrl?: string
  /** Section-specific numeric knob (e.g. featured course count) */
  count?: number
  items?: { id: string; title: L; body: L }[]
}

export interface NavItem {
  id: string
  label: L
  path: string
  enabled: boolean
}

export interface Theme {
  colors: {
    ivory: string
    forest: string
    charcoal: string
    champagne: string
    sage: string
    white: string
  }
  fonts: { display: DisplayFont; body: BodyFont }
  radius: 'sharp' | 'soft' | 'round'
}

export type DisplayFont = 'Cormorant Garamond' | 'Playfair Display'
export type BodyFont = 'Inter' | 'Manrope'

export interface Features {
  teacherChannels: boolean
  savedItems: boolean
  centerInquiry: boolean
  scrollVideo: boolean
  threeD: boolean
  announcements: boolean
  faq: boolean
  publicSearch: boolean
}

export interface Permissions {
  teacher: {
    editCourses: boolean
    editPrices: boolean
    editSchedules: boolean
    publishDirectly: boolean
    customizeChannel: boolean
    manageGroups: boolean
    uploadResources: boolean
  }
  student: {
    saveItems: boolean
    switchGroups: boolean
    downloadResources: boolean
  }
}

export interface Announcement {
  id: string
  title: L
  body: L
  audience: 'all' | 'students' | 'teachers'
  enabled: boolean
}

export interface FaqItem {
  id: string
  q: L
  a: L
}

export interface CourseCardTemplate {
  showCenter: boolean
  showTeacher: boolean
  showLevel: boolean
  showSchedule: boolean
  showCategory: boolean
  priceStyle: 'plain' | 'emphasis'
}

export interface DashboardModule {
  id: string
  enabled: boolean
}

export interface SiteConfig {
  brand: {
    name: string
    heroHeadline: L
    heroTagline: L
    primaryCta: L
    footerNote: L
    city: L
  }
  theme: Theme
  nav: NavItem[]
  pages: {
    home: Section[]
    howItWorks: Section[]
    centers: Section[]
  }
  faq: FaqItem[]
  features: Features
  permissions: Permissions
  packages: Package[]
  announcements: Announcement[]
  media: {
    /** Muted looping background film for the home hero (supplied asset) */
    heroVideoUrl: string
    heroPosterUrl: string
    furnitureVideoUrl: string
    furniturePosterUrl: string
  }
  courseCard: CourseCardTemplate
  payments: PaymentConfig
  dashboards: {
    student: DashboardModule[]
    teacher: DashboardModule[]
  }
}

export interface DemoState {
  site: SiteConfig
  centers: Center[]
  categories: Category[]
  teachers: Teacher[]
  subjects: Subject[]
  courses: Course[]
  videos: Video[]
  playlists: Playlist[]
  resources: Resource[]
  students: Student[]
  sessions: LessonSession[]
  attendance: AttendanceRecord[]
}

export interface Viewer {
  role: Role
  teacherId?: string
  studentId?: string
  groupIds: string[]
}
