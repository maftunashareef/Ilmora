// ─────────────────────────────────────────────────────────────────────────────
// ILMORA domain types. Everything the store persists is described here.
// Structured so a future server can own authorization: every content item
// carries status + visibility + audience, and access checks live in lib/access.
// ─────────────────────────────────────────────────────────────────────────────

export type Lang = 'uz' | 'ru' | 'en'
export type L = Record<Lang, string>

/** The workspace an account lands in; 'ministry' — the ministry's figures and registry (`/ministry`); 'institution' — an institution's representative (`/institution`). */
export type Role = 'visitor' | 'student' | 'teacher' | 'center' | 'admin' | 'ministry' | 'institution'

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

/** PENDING: registered by the center, waiting for approval (not public). ACTIVE: listed. BLOCKED: hidden, workspace locked. */
export type CenterStatus = 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'REJECTED'

export interface Center {
  id: string
  /** URL-friendly id (API); absent in local sample data */
  slug?: string
  name: string
  district: L
  description: L
  tone: string // hex accent used in generated covers
  /** Absent in sample data (every sample center is listed). */
  status?: CenterStatus
  address?: string | null
  phone?: string | null
}

/** The center's own settings for offline attendance (center workspace and Super Admin only). */
export interface CenterCheckInSettings {
  /** Minutes before a lesson starts when check-in opens. */
  checkInBeforeMin: number
  /** Minutes after a lesson starts when check-in closes and absences are recorded. */
  absenceAfterMin: number
  lat: number | null
  lng: number | null
  /** Metres from the center a check-in may come from; null = no location check. */
  geoRadiusM: number | null
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

/** OFFLINE: groups with seats and a schedule, sold through subscriptions. ONLINE: a free external course opened on the provider's site. */
export type LearningFormat = 'OFFLINE' | 'ONLINE'
/** Whether an online course ends with a certificate. AVAILABLE: offered, but the provider's page does not say whether it is free. */
export type CertificateKind = 'NONE' | 'FREE' | 'PAID' | 'AVAILABLE'

/** A course discount window; instants are ISO-8601 UTC strings. Active when startsAt <= now < endsAt. */
export interface CourseDiscount {
  percent: number
  startsAt: string
  endsAt: string
}

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
  /** Absent means OFFLINE (every course created before the field existed). Use courseFormat() / isOnlineCourse(). */
  learningFormat?: LearningFormat
  /** ONLINE only: the course page on the provider's own site (https). */
  externalUrl?: string | null
  /** ONLINE only: the organisation that publishes the course, as a name (not an ILMORA center). */
  providerName?: string | null
  /** ONLINE only: the instructor or teaching team named by the provider, as text. */
  instructorName?: string | null
  /** ONLINE only; absent means no certificate is offered. */
  certificate?: CertificateKind
  /** ONLINE only: how long the course takes, in words, as the provider states it. */
  durationText?: L | null
  /** Monthly price in Uzbek so‘m (ONLINE courses are free: 0) */
  price: number
  /** Discount window while it has not expired (it may start later). `price` stays the list price: use finalPriceSom(). */
  discount?: CourseDiscount | null
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
  avatarUrl?: string | null
  bannerUrl?: string | null
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

/** What a payment buys: a period (days or one calendar month) or a number of attended lessons. */
export type SubscriptionKind = 'PERIOD' | 'LESSONS'
/** Why a subscription is blocked: the period ended or the bought lessons are used up. */
export type SubscriptionBlockReason = 'period_ended' | 'lessons_exhausted'

export interface Subscription {
  packageId: string | null
  groupIds: string[]
  /** 'active' includes a blocked (PAST_DUE) subscription whose seats are still held: see `blocked`. */
  status: 'none' | 'active'
  startedAt?: string
  renewsAt?: string
  kind?: SubscriptionKind
  /** LESSONS kind: lessons bought for the period and lessons attended so far. */
  lessonsTotal?: number | null
  lessonsUsed?: number
  /** True while check-ins and course materials are refused (renewal reactivates instantly). */
  blocked?: boolean
  blockReason?: SubscriptionBlockReason | null
  /** PAST_DUE only: when the seats are released unless a payment arrives. */
  graceEndsAt?: string | null
  /** Amount billed per period in tiyin, exactly as charged at checkout (discounts included); absent in demo data. */
  amountMinor?: string
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
  /** Exceptions to the weekly pattern: a one-off lesson, or a lesson moved here from another date. */
  isExtra?: boolean
  rescheduledFromId?: string | null
  note?: string | null
}

/** qr: lesson QR shown by the teacher; center_qr: the center's standing QR; manual: teacher/center correction; auto: absence recorded by the worker. */
export type AttendanceMethod = 'qr' | 'center_qr' | 'manual' | 'auto'

export interface AttendanceRecord {
  id: string
  sessionId: string
  studentId: string
  checkedInAt: string
  method: AttendanceMethod
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
  /** Absent means PERIOD with one calendar month per payment (every package before access kinds existed). */
  accessKind?: SubscriptionKind
  /** PERIOD: days per payment; null = one calendar month. */
  periodDays?: number | null
  /** LESSONS: attended lessons per payment. */
  lessonCount?: number | null
}

/** In-app notification; the text comes from the dictionary key `notif.<type>` filled with `params` in the reader's language. */
export interface AppNotification {
  id: string
  type: string
  params: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

/**
 * One required subject of a ready-made preset. `label` is the subject as the university states it; `courseId` points at
 * the existing ILMORA offline course that prepares for it (null while the catalog has no such course: it is then reported
 * as missing and the package stays a draft, never filled with an invented course).
 */
export interface PresetSlot {
  id: string
  label: L
  courseId: string | null
  /**
   * An extra the student may leave out (for example IELTS preparation when an English certificate is required after the
   * exam): offered with the package but not part of its admission subjects. Still has to map to an available course.
   */
  optional?: boolean
}

/** A study direction (programme or major) as the university names it, with the entrance subjects it states for it. */
export interface UniversityDirection {
  id: string
  name: L
  /** Entrance subjects in the university's own terms; empty when the official page names none. */
  subjects: L[]
}

/** A faculty or school of a university and its directions. */
export interface UniversityFaculty {
  id: string
  name: L
  directions: UniversityDirection[]
}

/** A university that has preparation packages. Plain data entered by the Super Admin; ILMORA is not affiliated with it. */
export interface University {
  id: string
  name: string
  /** The name in each language, when it has official translations or is a preparation track (see universityName). */
  localName?: L
  /**
   * 'track': general preparation for a kind of university (medical, law), not one university. Shown in its own section
   * and never presented as a degree programme of any university.
   */
  kind?: 'track'
  /** Short form shown on small cards, for example "WIUT". */
  shortName?: string
  city?: string
  country?: string
  /** The university's official website (https). */
  website?: string
  /** One or two factual sentences from the university's own website (founding, partner university, language). */
  description?: L
  /** The official logo (an upload, or a file shipped under /universities/); cards show the short name until there is one. */
  logoUrl?: string
  /** The logo is light, made for dark backgrounds (for example a white word mark): it is shown on a dark green tile. */
  logoOnDark?: boolean
  /** Faculties and their directions; a university without them lists its packages directly. */
  faculties?: UniversityFaculty[]
  /**
   * Shown on the University Preparation page even while none of its packages is published (its packages stay drafts
   * until verified). Without it, a university is shown once one of its packages is published (see isUniversityListed).
   */
  published?: boolean
}

/** needs_review: the requirement could not be confirmed from an official page (or no source is recorded yet). */
export type AdmissionStatus = 'verified' | 'needs_review'

/** Where a package's required subjects come from, and whether they were confirmed against an official page. */
export interface AdmissionSource {
  /** The official page the requirement comes from (https); empty until one is recorded. */
  url: string
  /** The academic year that page states, such as "2025/2026"; empty when it states none. */
  academicYear: string
  /** The date the page was last checked, YYYY-MM-DD; empty until checked. */
  checkedOn: string
  status: AdmissionStatus
  /** A short plain note: what was confirmed, or what is unclear. */
  note: string
}

/**
 * A ready-made set of existing courses (for example a university-preparation package). It only fills the cart:
 * pricing, seats, schedule rules and checkout stay the regular ones. Hidden from the public until `enabled` (published),
 * and a university package can only be published while its admission requirements are verified.
 */
export interface Preset {
  id: string
  /** The university this package prepares for. Absent for presets that are not about a university. */
  universityId?: string
  /** Older free-text university name (before universities were records); used only when `universityId` is absent. */
  university?: string
  /** The faculty or program this package prepares for. */
  program?: L
  /** The directions of its university this package prepares for (one package may serve several with the same subjects). */
  directionIds?: string[]
  /** Package title. */
  name: L
  description: L
  /** The required subjects, each mapped to an ILMORA course. */
  slots: PresetSlot[]
  /** How long the preparation takes, in months, as set by the Super Admin; otherwise the longest included course. */
  durationMonths?: number
  /** Official source of the required subjects and their verification state. */
  admission?: AdmissionSource
  /** Published (shown on the site) when true, otherwise a draft. */
  enabled: boolean
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
  | 'discounts'
  /** Teaser for "My set", the course finder page (/course-finder). */
  | 'courseFinder'
  /** "How ILMORA works": the five-step journey from choosing courses to the first lesson (texts from the dictionary). */
  | 'journey'
  /** University preparation: cards of the universities that have a published package, linking to /universities. */
  | 'universities'

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
  /** Ready-made course presets; absent in site configs saved before presets existed. */
  presets?: Preset[]
  /** Universities that preparation packages (presets) refer to; absent in site configs saved before they existed. */
  universities?: University[]
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
