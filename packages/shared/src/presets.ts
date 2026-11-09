import { isPublicListed } from './access.js'
import { isSafeExternalUrl } from './catalog.js'
import { finalPriceSom, type DiscountWindow } from './pricing.js'
import { overlaps } from './schedule.js'
import type { AdmissionSource, Course, Group, L, Preset, PresetSlot, University, UniversityDirection, UniversityFaculty } from './types.js'

const l = (uz: string, ru: string, en: string): L => ({ uz, ru, en })

/** A source record with nothing confirmed yet: every new package starts here, so it cannot be published by accident. */
export const emptyAdmission = (): AdmissionSource => ({ url: '', academicYear: '', checkedOn: '', status: 'needs_review', note: '' })

/** A new, unpublished preset with one blank required subject; no course is chosen and nothing is verified. */
export function newPreset(id: string, universityId?: string): Preset {
  return {
    id,
    universityId,
    program: l('', '', ''),
    name: l('', '', ''),
    description: l('', '', ''),
    slots: [{ id: `${id}-s1`, label: l('', '', ''), courseId: null }],
    directionIds: [],
    admission: emptyAdmission(),
    enabled: false,
  }
}

/** A new university record to fill in. */
export const newUniversity = (id: string): University => ({ id, name: '', shortName: '', city: '', country: '', website: '', logoUrl: '', faculties: [] })
export const newFaculty = (id: string): UniversityFaculty => ({ id, name: l('', '', ''), directions: [] })
export const newDirection = (id: string): UniversityDirection => ({ id, name: l('', '', ''), subjects: [] })

/** The part of a course a preset needs to decide availability; groups are the course's non-deleted groups. */
export type PresetCourse = Pick<Course, 'id' | 'status' | 'visibility'> & { groups: { id: string }[] }

export type PresetIssueReason = 'unset' | 'missing' | 'unavailable' | 'no-groups' | 'duplicate'
export interface PresetIssue {
  slotId: string
  reason: PresetIssueReason
}

/**
 * A preset is ready only when every slot holds a different, existing, published and public course that has at
 * least one group. Anything else makes the whole preset unavailable: it is never shown half-filled.
 */
export function presetReadiness(preset: Pick<Preset, 'slots'>, courses: PresetCourse[]): { ready: boolean; issues: PresetIssue[] } {
  const byId = new Map(courses.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const issues: PresetIssue[] = []
  for (const slot of preset.slots) {
    if (!slot.courseId) {
      issues.push({ slotId: slot.id, reason: 'unset' })
      continue
    }
    const course = byId.get(slot.courseId)
    if (!course) issues.push({ slotId: slot.id, reason: 'missing' })
    else if (!isPublicListed(course)) issues.push({ slotId: slot.id, reason: 'unavailable' })
    else if (course.groups.length === 0) issues.push({ slotId: slot.id, reason: 'no-groups' })
    if (seen.has(slot.courseId)) issues.push({ slotId: slot.id, reason: 'duplicate' })
    seen.add(slot.courseId)
  }
  return { ready: preset.slots.length > 0 && issues.length === 0, issues }
}

/**
 * The slots a purchase includes: every required slot, plus the optional ones the student chose. Without a choice
 * (`chosenOptional` undefined) every slot counts, which is how readiness and older callers see a package.
 */
export const chosenSlots = (preset: Pick<Preset, 'slots'>, chosenOptional?: string[]): PresetSlot[] =>
  preset.slots.filter((s) => !s.optional || !chosenOptional || chosenOptional.includes(s.id))

/** The preset's courses in slot order, once each; slots without a (known) course are skipped. */
export function presetCourses<T extends { id: string }>(preset: Pick<Preset, 'slots'>, courses: T[], chosenOptional?: string[]): T[] {
  const out: T[] = []
  for (const slot of chosenSlots(preset, chosenOptional)) {
    const course = slot.courseId ? courses.find((c) => c.id === slot.courseId) : undefined
    if (course && !out.includes(course)) out.push(course)
  }
  return out
}

/**
 * Splits a preset's courses into those still to add and those the cart already holds (in any group), so adding a
 * preset never duplicates a course or replaces a group the student already chose.
 */
export function presetCartPlan<T extends { id: string; groups: { id: string }[] }>(preset: Pick<Preset, 'slots'>, courses: T[], cartGroupIds: string[], chosenOptional?: string[]): { toAdd: T[]; inCart: T[] } {
  const toAdd: T[] = []
  const inCart: T[] = []
  for (const course of presetCourses(preset, courses, chosenOptional)) (course.groups.some((g) => cartGroupIds.includes(g.id)) ? inCart : toAdd).push(course)
  return { toAdd, inCart }
}

export type GroupPick = { ok: true; groups: Group[] } | { ok: false; reason: 'full' | 'conflict'; courseId: string; conflictWith?: string }

/**
 * One group per course for adding a whole package at once: no group is full and none overlaps another or a group
 * already in the cart. Groups are tried in the order the course lists them, moving to the next one only when a later
 * course would clash, so the result is the earliest workable combination. Nothing is picked when a course cannot fit.
 */
export function pickPresetGroups(courses: { id: string; groups: Group[] }[], taken: Group[], isFull: (g: Group) => boolean): GroupPick {
  const open = courses.map((c) => c.groups.filter((g) => !isFull(g)))
  const fullCourse = courses.find((_, i) => open[i].length === 0)
  if (fullCourse) return { ok: false, reason: 'full', courseId: fullCourse.id }
  const chosen: Group[] = []
  let deepest = 0
  const place = (i: number): boolean => {
    deepest = Math.max(deepest, i)
    if (i === courses.length) return true
    for (const g of open[i]) {
      if (taken.some((t) => overlaps(t, g)) || chosen.some((c) => overlaps(c, g))) continue
      chosen.push(g)
      if (place(i + 1)) return true
      chosen.pop()
    }
    return false
  }
  if (place(0)) return { ok: true, groups: chosen }
  // The course no combination got past, and a course of the cart its groups clash with (when that is the reason).
  const stuck = courses[Math.min(deepest, courses.length - 1)]
  const clash = taken.find((t) => open[courses.indexOf(stuck)].every((g) => overlaps(t, g)))
  return { ok: false, reason: 'conflict', courseId: stuck.id, conflictWith: clash?.courseId }
}

/** Preparation length in months: the Super Admin's value, otherwise the longest included course (null without courses). */
export function presetDurationMonths(preset: Pick<Preset, 'slots' | 'durationMonths'>, courses: { id: string; durationMonths: number }[], chosenOptional?: string[]): number | null {
  if (preset.durationMonths) return preset.durationMonths
  const months = presetCourses(preset, courses, chosenOptional).map((c) => c.durationMonths)
  return months.length ? Math.max(...months) : null
}

/** Every direction of a university with its faculty, in the order the Super Admin entered them. */
export const universityDirections = (u: Pick<University, 'faculties'>): { faculty: UniversityFaculty; direction: UniversityDirection }[] =>
  (u.faculties ?? []).flatMap((faculty) => faculty.directions.map((direction) => ({ faculty, direction })))

/** The packages that prepare for one direction. */
export const presetsForDirection = <P extends Pick<Preset, 'directionIds'>>(presets: P[], directionId: string): P[] =>
  presets.filter((p) => p.directionIds?.includes(directionId))

/** Direction ids a package names that its university does not have (a package without a university may name none). */
export function unknownDirections(preset: Pick<Preset, 'universityId' | 'directionIds'>, universities: Pick<University, 'id' | 'faculties'>[]): string[] {
  const ids = preset.directionIds ?? []
  if (ids.length === 0) return []
  const u = preset.universityId ? universities.find((x) => x.id === preset.universityId) : undefined
  const known = new Set(u ? universityDirections(u).map((d) => d.direction.id) : [])
  return ids.filter((id) => !known.has(id))
}

/**
 * Provisional preset price: the sum of the current course prices, each with its own active course discount if it has
 * one (no separate preset price or preset discount exists, so nothing stacks).
 */
export const presetTotal = (courses: { price: number; discount?: DiscountWindow | null }[], now: Date = new Date()): number =>
  courses.reduce((sum, c) => sum + finalPriceSom(c, now), 0)

/** A package prepares for a university when it names one (a record, or the older free-text name). */
export const isUniversityPreset = (p: Pick<Preset, 'universityId' | 'university'>): boolean => !!(p.universityId || p.university?.trim())

export type AdmissionIssue = 'no-source' | 'no-year' | 'no-date' | 'not-verified'
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * What stops a university package from being published on the admission side: it needs an official page (https), the
 * academic year that page states, the date it was checked, and the status "verified". Nothing here is inferred.
 */
export function admissionIssues(admission: AdmissionSource | undefined): AdmissionIssue[] {
  const issues: AdmissionIssue[] = []
  if (!admission || !isSafeExternalUrl(admission.url)) issues.push('no-source')
  if (!admission?.academicYear?.trim()) issues.push('no-year')
  if (!admission || !DATE_ONLY.test(admission.checkedOn)) issues.push('no-date')
  if (admission?.status !== 'verified') issues.push('not-verified')
  return issues
}

/**
 * The single rule for publishing a package. Every subject that names a course must point at a different, available
 * course (presetReadiness). A package that is not about a university needs every subject covered. A university package
 * needs an official source page and at least one required subject covered by an ILMORA course: subjects ILMORA has no
 * course for stay listed as not covered (never filled with a made-up course), and requirements that are not verified
 * yet are published marked "requires confirmation" (presetNeedsConfirmation). The cart only ever gets real courses.
 */
export function presetPublishability(preset: Preset, courses: PresetCourse[]): { ok: boolean; ready: boolean; issues: PresetIssue[]; admission: AdmissionIssue[] } {
  const { ready, issues } = presetReadiness(preset, courses)
  if (!isUniversityPreset(preset)) return { ok: ready, ready, issues, admission: [] }
  const admission = admissionIssues(preset.admission)
  const blocking = issues.filter((i) => i.reason !== 'unset')
  const covered = preset.slots.some((s) => !s.optional && !!s.courseId)
  return { ok: blocking.length === 0 && covered && !admission.includes('no-source'), ready, issues, admission }
}

/** A university package whose admission requirements are not verified yet: shown marked "requires confirmation". */
export const presetNeedsConfirmation = (preset: Pick<Preset, 'universityId' | 'university' | 'admission'>): boolean =>
  isUniversityPreset(preset) && admissionIssues(preset.admission).length > 0

/** Required subjects that no ILMORA course covers yet: reported, never papered over with a made-up course. */
export const presetMissingSubjects = (preset: Pick<Preset, 'slots'>): PresetSlot[] => preset.slots.filter((s) => !s.courseId)

export interface UniversityGroup {
  university: University
  presets: Preset[]
}

/** The university record of a package; an older free-text name becomes a record without an id of its own. */
export function universityOf(preset: Pick<Preset, 'universityId' | 'university'>, universities: University[]): University | undefined {
  if (preset.universityId) return universities.find((u) => u.id === preset.universityId)
  const name = preset.university?.trim()
  return name ? { id: `legacy:${name}`, name } : undefined
}

/** The university's name in a language: its translated name when it has one, otherwise its official name. */
export const universityName = (u: Pick<University, 'name' | 'localName'>, lang: keyof L): string => u.localName?.[lang]?.trim() || u.name

/** A general preparation track (medical, law), as opposed to one university. */
export const isPreparationTrack = (u: Pick<University, 'kind'>): boolean => u.kind === 'track'

/**
 * Whether visitors see the university: the admin marked it published, or one of its packages is published. A university
 * whose packages are still being verified can be shown this way; its unpublished packages stay out of the public site.
 */
export const isUniversityListed = (university: Pick<University, 'id' | 'published'>, presets: Pick<Preset, 'enabled' | 'universityId'>[]): boolean =>
  university.published === true || presets.some((p) => p.enabled && p.universityId === university.id)

/** Packages grouped by university (alphabetical); packages without a university and empty universities are left out. */
export function groupByUniversity(presets: Preset[], universities: University[]): UniversityGroup[] {
  const groups = new Map<string, UniversityGroup>()
  for (const preset of presets) {
    const university = universityOf(preset, universities)
    if (!university) continue
    const group = groups.get(university.id) ?? { university, presets: [] }
    group.presets.push(preset)
    groups.set(university.id, group)
  }
  return [...groups.values()].sort((a, b) => a.university.name.localeCompare(b.university.name))
}
