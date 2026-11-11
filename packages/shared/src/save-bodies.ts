import { isOnlineCourse } from './catalog.js'
import type { Course, Publishable } from './types.js'

/**
 * What the site sends to save a course and its groups (web store: upsertCourse). One function for the site and for the
 * API's contract test: a teacher saving a course without changing what they may not change gets 200 (Н1, review
 * 11.11 — the site always sends the price, the discount, the center and the schedule). Any field added here is
 * checked against the API by that test at once.
 */

/** A browser-only `blob:` preview is never saved: without storage an uploaded file has no address at all. */
const storable = (url: string | null | undefined): string | null => (url && !/^blob:/i.test(url) ? url : null)

export const publishableSaveBody = (p: Partial<Publishable>) => ({
  ...(p.status ? { status: p.status } : {}), ...(p.visibility ? { visibility: p.visibility } : {}), ...(p.audience ? { audience: p.audience } : {}),
  ...(p.featured !== undefined ? { featured: p.featured } : {}), ...(p.reviewRequested !== undefined ? { reviewRequested: p.reviewRequested } : {}),
})

export const courseSaveBody = (c: Course, withDiscount = false) => ({
  title: c.title, categoryId: c.categoryId, subjectId: c.subjectId ?? null, summary: c.summary, description: c.description, curriculum: c.curriculum,
  // An online course belongs to the platform center/profile, which the server sets; only offline courses send them.
  ...(isOnlineCourse(c) ? {} : { centerId: c.centerId, teacherId: c.teacherId }),
  level: c.level, durationMonths: c.durationMonths, price: Math.round(c.price), coverSeed: c.coverSeed, imageUrl: storable(c.imageUrl), meyosGrant: !!c.meyosGrant, ...publishableSaveBody(c),
  // Only the Super Admin sends the discount; the server refuses it from anyone else.
  ...(withDiscount ? { discount: c.discount ?? null } : {}),
  // The learning format always travels; the link, provider and certificate only for online courses (the server accepts them from the Super Admin only).
  ...(isOnlineCourse(c)
    ? { learningFormat: 'ONLINE' as const, externalUrl: c.externalUrl ?? null, providerName: c.providerName ?? null, instructorName: c.instructorName ?? null, certificate: c.certificate ?? ('NONE' as const), durationText: c.durationText ?? null }
    : { learningFormat: 'OFFLINE' as const }),
})

export const groupSaveBody = (g: Course['groups'][number]) => ({ name: g.name, days: g.days, start: g.start, end: g.end, room: g.room, capacity: g.capacity })
