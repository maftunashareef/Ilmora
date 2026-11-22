import { isPublicListed } from './access.js'
import { isOnlineCourse, isSafeExternalUrl } from './catalog.js'
import { MAX_CART_COURSES } from './enrollment.js'
import { presetCourses, presetPublishability, presetTotal } from './presets.js'
import { discountInForce, finalPriceSom, isDiscountActive } from './pricing.js'
import { groupHours, overlaps } from './schedule.js'
import type { Category, CertificateKind, Course, Group, Level, Package, Preset } from './types.js'

/**
 * "My set" (Mening töplamim): course and package suggestions built only from the live catalog. There is no AI model
 * here: every suggestion comes from rules over data the catalog already holds (format, category, level, price with its
 * active discount, the group schedule and free seats), and every reason shown to the student is one of those facts.
 *
 * An AI ranking can be added later without changing these guarantees: it would run on the server (its key never
 * reaches the browser), return course ids only, and go through applyExternalRanking(), which can reorder the courses
 * the rules accept but never add one, so it cannot invent a course, a price or a free seat.
 */

export type FinderGoal = 'university' | 'ielts' | 'career' | 'personal'
export type FinderFormat = 'offline' | 'online' | 'any'
export type FinderLevel = Level | 'any'

/** Monthly budget choices in so‘m for everything together; 0 means free courses only. */
export const FINDER_BUDGETS = [0, 750_000, 1_500_000, 2_500_000] as const
/** Hours a week the student can spend in lessons. */
export const FINDER_HOURS = [3, 6, 10] as const

export interface FinderAnswers {
  goal: FinderGoal
  /** Subjects (category ids) the student is interested in; empty means any subject. */
  categoryIds: string[]
  level: FinderLevel
  format: FinderFormat
  /** One of FINDER_BUDGETS, or 'any' for no limit. */
  budget: number | 'any'
  /** One of FINDER_HOURS, or 'any' for no limit. */
  hours: number | 'any'
}

export const DEFAULT_FINDER_ANSWERS: FinderAnswers = { goal: 'personal', categoryIds: [], level: 'any', format: 'any', budget: 'any', hours: 'any' }

const GOALS: readonly FinderGoal[] = ['university', 'ielts', 'career', 'personal']
const LEVELS: readonly Level[] = ['beginner', 'intermediate', 'advanced']
const FORMATS: readonly FinderFormat[] = ['offline', 'online', 'any']

/**
 * How a goal relates to the catalog: the category slugs that serve it, and exam names that a course's own slug or
 * English title must contain before the course is described as preparing for that exam.
 */
export const GOAL_PROFILES: Record<FinderGoal, { categories: readonly string[]; exams: readonly string[] }> = {
  university: { categories: ['university', 'math', 'sciences', 'english'], exams: ['dtm', 'sat', 'ielts'] },
  ielts: { categories: ['english'], exams: ['ielts'] },
  career: { categories: ['it', 'python', 'frontend', 'backend', 'ai-ml', 'ui-ux', 'graphic-design', 'design', 'furniture', 'economics'], exams: [] },
  personal: { categories: [], exams: [] },
}

/** Category slug; local sample categories have no slug, their id is "cat-<slug>". */
export const categorySlug = (c: Pick<Category, 'id' | 'slug'>): string => c.slug ?? c.id.replace(/^cat-/, '')

/** A fact behind a suggestion; the web app turns each one into a sentence in the visitor's language. */
export type FinderReason =
  | { code: 'subject'; categoryId: string }
  | { code: 'goal'; goal: Exclude<FinderGoal, 'personal'> }
  | { code: 'exam'; exam: string }
  | { code: 'level'; level: Level; exact: boolean }
  | { code: 'budget'; price: number }
  | { code: 'free' }
  | { code: 'discount'; percent: number; endsAt: string | null }
  | { code: 'hours'; hours: number }
  | { code: 'selfPaced' }
  | { code: 'seats'; left: number }
  | { code: 'certificate'; kind: Exclude<CertificateKind, 'NONE'> }

/** Why a relevant course is only a close match: it misses one of the student's limits. */
export type FinderWarning = { code: 'overBudget'; price: number } | { code: 'overHours'; hours: number } | { code: 'levelGap'; level: Level }

export interface FinderMatch<T extends Course = Course> {
  course: T
  /** Ordering only; the visitor sees `fit` and the reasons, never a made-up percentage. */
  score: number
  fit: 'strong' | 'good'
  reasons: FinderReason[]
  warnings: FinderWarning[]
  /** Offline: the group suggested for this course (free seat, fewest hours). Online: null. */
  group: Group | null
  /** Monthly price in so‘m after the discount active now (0 for online courses). */
  price: number
  /** Weekly lesson hours of the suggested group; null for self-paced online courses. */
  hours: number | null
}

/** A ready set of offline courses with one group each, no schedule clashes and a free seat in every group. */
export interface FinderPlan<T extends Course = Course> {
  size: number
  /** The enabled package for exactly `size` courses, or null for a custom selection ("build your own"). */
  packageId: string | null
  items: { course: T; group: Group }[]
  /** Monthly total in so‘m with each course's own active discount; nothing else is taken off. */
  total: number
  /** Monthly total before discounts. */
  listTotal: number
  hours: number
}

export interface FinderPresetMatch {
  preset: Preset
  total: number
  /** How many of the package's courses are in the student's chosen subjects. */
  subjectMatches: number
  withinBudget: boolean
}

export interface FinderResult<T extends Course = Course> {
  /** Where the ranking comes from; 'rules' until an external ranking is applied. */
  source: string
  matches: FinderMatch<T>[]
  nearby: FinderMatch<T>[]
  /** Best plan for 1, 2 and 3 courses, where one exists. */
  plans: FinderPlan<T>[]
  /** The size of the plan to show first, or null when no plan exists. */
  recommendedSize: number | null
  /** Published university preparation packages, for the university goal only. */
  presets: FinderPresetMatch[]
}

export interface FinderInput<T extends Course = Course> {
  answers: FinderAnswers
  courses: T[]
  categories: Pick<Category, 'id' | 'slug'>[]
  packages?: Pick<Package, 'id' | 'maxCourses' | 'enabled'>[]
  presets?: Preset[]
  /** Seats still free in a group; by default its capacity minus the API's `enrolled` count. */
  seatsLeft?: (group: Group) => number
  now?: Date
}

const MAX_MATCHES = 12
const MAX_NEARBY = 6
/** Courses considered when building plans; small enough to try every combination. */
const PLAN_CANDIDATES = 8
const PLAN_SIZES = [1, 2, 3].filter((n) => n <= MAX_CART_COURSES)
const STRONG_SCORE = 60

const defaultSeatsLeft = (g: Group) => g.capacity - (g.enrolled ?? 0)
const withinLimit = (value: number, limit: number | 'any') => limit === 'any' || value <= limit
const levelDistance = (a: Level, b: Level) => Math.abs(LEVELS.indexOf(a) - LEVELS.indexOf(b))

function examsIn(course: Pick<Course, 'slug' | 'title'>, exams: readonly string[]): string[] {
  const text = `${course.slug ?? ''} ${course.title.en}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  return exams.filter((e) => ` ${text} `.includes(` ${e} `))
}

/** Scores one course against the answers; null when it can never be suggested (unlisted, wrong format, full, unrelated). */
function evaluate<T extends Course>(course: T, input: FinderInput<T>, slugs: Map<string, string>, now: Date): FinderMatch<T> | null {
  const { answers } = input
  if (!isPublicListed(course)) return null
  const online = isOnlineCourse(course)
  if (answers.format === 'offline' && online) return null
  if (answers.format === 'online' && !online) return null
  // "Free only" means online courses: every offline course has a monthly price.
  if (answers.budget === 0 && !online) return null
  if (online && !isSafeExternalUrl(course.externalUrl)) return null

  const reasons: FinderReason[] = []
  const warnings: FinderWarning[] = []
  let score = 0

  const profile = GOAL_PROFILES[answers.goal]
  const subject = answers.categoryIds.includes(course.categoryId)
  const goalCategory = profile.categories.includes(slugs.get(course.categoryId) ?? '')
  const exams = examsIn(course, profile.exams)
  const filtered = answers.categoryIds.length > 0 || answers.goal !== 'personal'
  if (filtered && !subject && !goalCategory && exams.length === 0) return null
  if (subject) { score += 40; reasons.push({ code: 'subject', categoryId: course.categoryId }) }
  if (exams.length > 0) { score += 40; reasons.push(...exams.map((exam) => ({ code: 'exam' as const, exam }))) }
  else if (goalCategory && answers.goal !== 'personal') { score += 25; reasons.push({ code: 'goal', goal: answers.goal }) }

  if (answers.level !== 'any') {
    const distance = levelDistance(answers.level, course.level)
    if (distance === 0) { score += 15; reasons.push({ code: 'level', level: course.level, exact: true }) }
    else if (distance === 1) { score += 6; reasons.push({ code: 'level', level: course.level, exact: false }) }
    else warnings.push({ code: 'levelGap', level: course.level })
  }

  const price = finalPriceSom(course, now)
  if (online) reasons.push({ code: 'free' })
  else if (!withinLimit(price, answers.budget)) warnings.push({ code: 'overBudget', price })
  else if (answers.budget !== 'any') reasons.push({ code: 'budget', price })

  const sale = discountInForce(course, now)
  if (isDiscountActive(sale, now)) { score += 5; reasons.push({ code: 'discount', percent: sale!.percent, endsAt: typeof sale!.endsAt === 'string' ? sale!.endsAt : null }) }

  let group: Group | null = null
  let hours: number | null = null
  if (online) {
    if (answers.hours !== 'any') score += 5
    reasons.push({ code: 'selfPaced' })
    if (course.certificate && course.certificate !== 'NONE') reasons.push({ code: 'certificate', kind: course.certificate })
  } else {
    const seatsLeft = input.seatsLeft ?? defaultSeatsLeft
    const open = course.groups.filter((g) => seatsLeft(g) > 0).sort((a, b) => groupHours(a) - groupHours(b) || a.id.localeCompare(b.id))
    if (open.length === 0) return null
    group = open[0]
    hours = groupHours(group)
    if (withinLimit(hours, answers.hours)) {
      if (answers.hours !== 'any') score += 10
      reasons.push({ code: 'hours', hours })
    } else warnings.push({ code: 'overHours', hours })
    reasons.push({ code: 'seats', left: seatsLeft(group) })
  }

  return { course, score, fit: score >= STRONG_SCORE ? 'strong' : 'good', reasons, warnings, group, price, hours }
}

const byRank = <T extends Course>(a: FinderMatch<T>, b: FinderMatch<T>) =>
  b.score - a.score || Number(b.course.featured) - Number(a.course.featured) || a.price - b.price || a.course.id.localeCompare(b.course.id)

/**
 * The best set of `size` offline courses: one group each, no two groups overlapping, a free seat in every group, within
 * the budget and the weekly hours. Highest total score wins; then the lower price, then fewer hours.
 */
function bestPlan<T extends Course>(candidates: FinderMatch<T>[], size: number, input: FinderInput<T>): FinderPlan<T> | null {
  type Item = { match: FinderMatch<T>; group: Group }
  type Found = { score: number; items: Item[]; total: number; hours: number }
  const { budget, hours: hourLimit } = input.answers
  const seatsLeft = input.seatsLeft ?? defaultSeatsLeft
  const options = candidates.map((m) => m.course.groups.filter((g) => seatsLeft(g) > 0))
  const found: { best: Found | null } = { best: null }

  const pick = (start: number, items: Item[], score: number, total: number, hours: number) => {
    if (items.length === size) {
      const b = found.best
      if (!b || score > b.score || (score === b.score && (total < b.total || (total === b.total && hours < b.hours)))) found.best = { score, items: [...items], total, hours }
      return
    }
    for (let i = start; i < candidates.length; i++) {
      const match = candidates[i]
      const nextTotal = total + match.price
      if (budget !== 'any' && nextTotal > budget) continue
      for (const group of options[i]) {
        const nextHours = hours + groupHours(group)
        if (!withinLimit(nextHours, hourLimit) || items.some((it) => overlaps(it.group, group))) continue
        items.push({ match, group })
        pick(i + 1, items, score + match.score, nextTotal, nextHours)
        items.pop()
      }
    }
  }
  pick(0, [], 0, 0, 0)
  const best = found.best
  if (!best) return null
  const pkg = input.packages?.find((p) => p.enabled && p.maxCourses === size)
  return {
    size,
    packageId: pkg?.id ?? null,
    items: best.items.map(({ match, group }) => ({ course: match.course, group })),
    total: best.total,
    listTotal: best.items.reduce((n, { match }) => n + match.course.price, 0),
    hours: best.hours,
  }
}

/** Published, ready university packages, ranked by how many of their courses are in the chosen subjects. */
function presetMatches<T extends Course>(input: FinderInput<T>, now: Date): FinderPresetMatch[] {
  if (input.answers.goal !== 'university' || !input.presets) return []
  const { budget, categoryIds } = input.answers
  return input.presets
    .filter((p) => p.enabled && presetPublishability(p, input.courses).ok)
    .map((preset) => {
      const list = presetCourses(preset, input.courses)
      const total = presetTotal(list, now)
      return { preset, total, subjectMatches: list.filter((c) => categoryIds.includes(c.categoryId)).length, withinBudget: budget !== 0 && withinLimit(total, budget) }
    })
    .sort((a, b) => Number(b.withinBudget) - Number(a.withinBudget) || b.subjectMatches - a.subjectMatches || a.total - b.total || a.preset.id.localeCompare(b.preset.id))
    .slice(0, 3)
}

/** Rule-based suggestions for the answers: matching courses, close matches that miss one limit, and ready plans. */
export function recommendCourses<T extends Course>(input: FinderInput<T>): FinderResult<T> {
  const now = input.now ?? new Date()
  const slugs = new Map(input.categories.map((c) => [c.id, categorySlug(c)]))
  const all = input.courses.map((c) => evaluate(c, input, slugs, now)).filter((m): m is FinderMatch<T> => m !== null).sort(byRank)
  const matches = all.filter((m) => m.warnings.length === 0)
  const nearby = all.filter((m) => m.warnings.length > 0)

  const candidates = matches.filter((m) => m.group !== null).slice(0, PLAN_CANDIDATES)
  const plans = PLAN_SIZES.map((size) => bestPlan(candidates, size, input)).filter((p): p is FinderPlan<T> => p !== null)
  // Show first the largest set in which every course is a strong match; otherwise a single course.
  const strongIds = new Set(matches.filter((m) => m.fit === 'strong').map((m) => m.course.id))
  const strongPlans = plans.filter((p) => p.items.every((it) => strongIds.has(it.course.id)))
  const recommendedSize = strongPlans.length > 0 ? strongPlans[strongPlans.length - 1].size : plans[0]?.size ?? null

  return { source: 'rules', matches: matches.slice(0, MAX_MATCHES), nearby: nearby.slice(0, MAX_NEARBY), plans, recommendedSize, presets: presetMatches(input, now) }
}

/**
 * Reorders the rule-based matches by an external ranking (for example an AI model's). Ids the rules did not accept are
 * ignored, accepted courses the ranking leaves out keep their order after the ranked ones, and plans and prices stay
 * the rules' own.
 */
export function applyExternalRanking<T extends Course>(result: FinderResult<T>, ranking: { source: string; courseIds: string[] }): FinderResult<T> {
  const order = new Map(ranking.courseIds.map((id, i) => [id, i]))
  const rank = (m: FinderMatch<T>) => order.get(m.course.id) ?? Number.MAX_SAFE_INTEGER
  const sorted = (list: FinderMatch<T>[]) => list.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m)
  return { ...result, source: ranking.source, matches: sorted(result.matches), nearby: sorted(result.nearby) }
}

/** Answers -> URL parameters, so a result can be reopened and shared. */
export function finderAnswersToParams(a: FinderAnswers): Record<string, string> {
  return { goal: a.goal, subjects: a.categoryIds.join(','), level: a.level, format: a.format, budget: String(a.budget), hours: String(a.hours) }
}

/**
 * URL parameters -> answers. Unknown values fall back to the defaults; `complete` is true only when every answer is
 * present and valid, so a shared link opens straight on the results. Unknown subjects are dropped.
 */
export function finderAnswersFromParams(params: { get(name: string): string | null }, categoryIds: string[]): { answers: FinderAnswers; complete: boolean } {
  const goal = params.get('goal') as FinderGoal | null
  const level = params.get('level') as FinderLevel | null
  const format = params.get('format') as FinderFormat | null
  const num = (v: string | null, allowed: readonly number[]) => (v === 'any' ? 'any' : v !== null && allowed.includes(Number(v)) && v.trim() !== '' ? Number(v) : null)
  const budget = num(params.get('budget'), FINDER_BUDGETS)
  const hours = num(params.get('hours'), FINDER_HOURS)
  const subjects = params.get('subjects')
  const answers: FinderAnswers = {
    goal: goal && GOALS.includes(goal) ? goal : DEFAULT_FINDER_ANSWERS.goal,
    categoryIds: (subjects ?? '').split(',').filter((id) => categoryIds.includes(id)),
    level: level && (level === 'any' || LEVELS.includes(level)) ? level : DEFAULT_FINDER_ANSWERS.level,
    format: format && FORMATS.includes(format) ? format : DEFAULT_FINDER_ANSWERS.format,
    budget: budget ?? DEFAULT_FINDER_ANSWERS.budget,
    hours: hours ?? DEFAULT_FINDER_ANSWERS.hours,
  }
  const complete = !!goal && GOALS.includes(goal) && subjects !== null && answers.level === level && answers.format === format && budget !== null && hours !== null
  return { answers, complete }
}
