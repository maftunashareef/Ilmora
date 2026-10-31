import { isPublicListed } from './access.js'
import { isSafeExternalUrl } from './catalog.js'
import { finalPriceSom, type DiscountWindow } from './pricing.js'
import type { AdmissionSource, Course, L, Preset, PresetSlot, University } from './types.js'

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
    admission: emptyAdmission(),
    enabled: false,
  }
}

/** A new university record to fill in. */
export const newUniversity = (id: string): University => ({ id, name: '', shortName: '', city: '', website: '' })

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

/** The preset's courses in slot order, once each; slots without a (known) course are skipped. */
export function presetCourses<T extends { id: string }>(preset: Pick<Preset, 'slots'>, courses: T[]): T[] {
  const out: T[] = []
  for (const slot of preset.slots) {
    const course = slot.courseId ? courses.find((c) => c.id === slot.courseId) : undefined
    if (course && !out.includes(course)) out.push(course)
  }
  return out
}

/**
 * Splits a preset's courses into those still to add and those the cart already holds (in any group), so adding a
 * preset never duplicates a course or replaces a group the student already chose.
 */
export function presetCartPlan<T extends { id: string; groups: { id: string }[] }>(preset: Pick<Preset, 'slots'>, courses: T[], cartGroupIds: string[]): { toAdd: T[]; inCart: T[] } {
  const toAdd: T[] = []
  const inCart: T[] = []
  for (const course of presetCourses(preset, courses)) (course.groups.some((g) => cartGroupIds.includes(g.id)) ? inCart : toAdd).push(course)
  return { toAdd, inCart }
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
 * The single rule for publishing a package: every required subject maps to an available ILMORA course
 * (presetReadiness) and, for a university package, the admission requirements are verified against an official page.
 */
export function presetPublishability(preset: Preset, courses: PresetCourse[]): { ok: boolean; ready: boolean; issues: PresetIssue[]; admission: AdmissionIssue[] } {
  const { ready, issues } = presetReadiness(preset, courses)
  const admission = isUniversityPreset(preset) ? admissionIssues(preset.admission) : []
  return { ok: ready && admission.length === 0, ready, issues, admission }
}

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
