'use client'
import { createContext, useContext } from 'react'
import type { CenterCheckInSettings, CenterKind, CenterStatus, Course, L, LessonSession, SubscriptionAccess, Teacher } from '@ilmora/shared'

/** Shapes of the center workspace API (`/v1/center/*`). */

export type CenterSection = 'overview' | 'courses' | 'teachers' | 'attendance' | 'students' | 'journal' | 'settings'

/**
 * Where the center views read and write. A center's own workspace uses `/center/*`; the Super Admin opens the same
 * views for any center under `/admin/centers/:id/*` (`admin` then skips the center-account gate).
 */
export interface CenterScope { base: string; admin: boolean; links: (section: CenterSection) => string }
export const CENTER_OWN_SCOPE: CenterScope = { base: '/center', admin: false, links: (s) => (s === 'overview' ? '/center' : `/center/${s}`) }
export const CenterScopeContext = createContext<CenterScope>(CENTER_OWN_SCOPE)
export const useCenterScope = () => useContext(CenterScopeContext)

export interface CenterProfile {
  id: string
  slug: string
  name: string
  /** What the center is (`Center.kind`): the center says so itself, the Super Admin can correct it. */
  kind: CenterKind
  /** A new name waiting for the Super Admin's approval (the public name stays until then). */
  pendingName?: string | null
  district: L
  description: L
  tone: string
  address: string | null
  phone: string | null
  status: CenterStatus
  approvedAt: string | null
  blockedAt: string | null
  blockReason: string | null
  createdAt: string
  checkIn: CenterCheckInSettings
}

export interface CenterLesson {
  session: LessonSession
  courseTitle: L
  courseId: string
  teacherName: string
  group: { id: string; name: string; room: string }
  roster: number
  present: number
  absent: number
}

export interface CenterOverview {
  center: CenterProfile
  counts: { teachers: number; courses: number; groups: number; students: number }
  today: CenterLesson[]
}

export interface CenterQr { code: string; url: string; rotatedAt: string | null }

export type CenterTeacher = Teacher & { account: { id: string; login: string | null; isActive: boolean } | null; courses: number }

export interface CenterStudent {
  id: string
  displayName: string
  district: string | null
  phoneMasked: string | null
  isActive: boolean
  groups: { id: string; name: string; courseId: string; courseTitle: L }[]
  subscription: (SubscriptionAccess & { status: string; kind: 'PERIOD' | 'LESSONS' }) | null
  attendance: { present: number; absent: number; excused: number }
}

/** `pricing`: ILMORA's commission and the discount range for the calculator in the course form (ТЗ 18.11, 9.3). */
export type CenterCourses = { center: { id: string; name: string }; courses: Course[]; pricing?: { commissionPercent: number; minDiscountPercent: number; maxDiscountPercent: number; minPriceSom: number } }

/** What the center sends for one of its offline courses (CourseInput on the API; the center id is fixed server-side). */
export const centerCourseInput = (c: Course) => ({
  title: c.title, categoryId: c.categoryId, subjectId: c.subjectId ?? null, summary: c.summary, description: c.description, curriculum: c.curriculum,
  centerId: c.centerId, teacherId: c.teacherId, level: c.level, durationMonths: c.durationMonths, price: Math.round(c.price), coverSeed: c.coverSeed, imageUrl: c.imageUrl ?? null,
  learningFormat: 'OFFLINE' as const, discount: c.discount ?? null,
  status: c.status, visibility: c.visibility, audience: c.audience, reviewRequested: c.reviewRequested ?? false,
})

export const centerGroupInput = (g: Course['groups'][number]) => ({ name: g.name, days: g.days, start: g.start, end: g.end, room: g.room, capacity: g.capacity })

