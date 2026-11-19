import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  activePercent,
  countLabel,
  DEFAULT_FINDER_ANSWERS,
  FINDER_BUDGETS,
  FINDER_HOURS,
  finderAnswersFromParams,
  finderAnswersToParams,
  isOnlineCourse,
  isoToTashkentLocal,
  isPreparationTrack,
  isSafeExternalUrl,
  MAX_CART_COURSES,
  NOUNS,
  recommendCourses,
  universityName,
  universityOf,
  type FinderAnswers,
  type FinderGoal,
  type FinderLevel,
  type FinderFormat,
  type FinderMatch,
  type FinderPlan,
  type FinderReason,
  type FinderWarning,
  type Lang,
} from '@ilmora/shared'
import { Link } from '@/lib/router'
import { useSearchParams } from '@/lib/routerHooks'
import { FormatBadge, PriceNow, SaveButton, ScheduleChips } from '../../components/course/CourseCard'
import { getCoursePhotoUrl } from '../../components/course/courseImage'
import { Badge, Button, Card, EmptyState, Eyebrow, Icon, LinkButton, Modal, Notice, PageTitle, Segmented } from '../../components/ui'
import { cx } from '../../components/ui/helpers'
import type { TKey } from '../../i18n/translations'
import { useT } from '../../i18n/useT'
import { isPublicListed } from '../../lib/access'
import { seatsLeft } from '../../lib/enrollment'
import { formatDate, formatSom } from '../../lib/format'
import { useCanSaveCourses, useCurrentStudent, useHydrated } from '../../store/selectors'
import { useStore, type BuilderResult } from '../../store/useStore'
import type { Course, Section } from '../../types'

/**
 * "My set" (Mening töplamim): six questions, then courses and a ready set from the catalog. The suggestions come from the
 * rules in @ilmora/shared (recommendCourses); nothing here is presented as AI. Adding to the cart goes through the same
 * store actions as the builder, so package limits, schedule clashes and seats are checked exactly as they are there.
 */

type QuestionId = 'goal' | 'subject' | 'level' | 'format' | 'budget' | 'hours'
const QUESTIONS: QuestionId[] = ['goal', 'subject', 'level', 'format', 'budget', 'hours']
const RESULTS = QUESTIONS.length
/** Answers kept in this browser only (a convenience); the shareable copy is the page URL. */
const STORAGE_KEY = 'ilmora.finder.answers.v1'

interface Option {
  value: string
  label: string
  hint?: string
  icon?: string
  glyph?: string
}

const fmtHours = (h: number, lang: Lang) => (Number.isInteger(h) ? String(h) : h.toFixed(1).replace('.', lang === 'en' ? '.' : ','))

const REASON_ICON: Record<FinderReason['code'], string> = {
  subject: 'grid', goal: 'star', exam: 'book', level: 'layers', budget: 'check', free: 'check', discount: 'star', hours: 'clock', selfPaced: 'clock', seats: 'users', certificate: 'file',
}

function readStoredAnswers(categoryIds: string[]): FinderAnswers | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = finderAnswersFromParams(new URLSearchParams(raw), categoryIds)
    return parsed.complete ? parsed.answers : null
  } catch {
    return null
  }
}

function writeStoredAnswers(answers: FinderAnswers): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, new URLSearchParams(finderAnswersToParams(answers)).toString())
    return true
  } catch {
    return false
  }
}

/** Sentences for the reasons and warnings, in the visitor's language. */
function useReasonText() {
  const { t, tr, lang } = useT()
  const categories = useStore((s) => s.categories)
  const reason = useCallback(
    (r: FinderReason): string => {
      switch (r.code) {
        case 'subject': return t('finder.reason.subject', { name: tr(categories.find((c) => c.id === r.categoryId)?.name) })
        case 'goal': return t('finder.reason.goal', { goal: t(`finder.goal.${r.goal}` as TKey) })
        case 'exam': return t('finder.reason.exam', { exam: r.exam.toUpperCase() })
        case 'level': return t(r.exact ? 'finder.reason.levelExact' : 'finder.reason.levelNear', { level: t(`level.${r.level}` as TKey) })
        case 'budget': return t('finder.reason.budget', { price: formatSom(r.price, lang) })
        case 'free': return t('finder.reason.free')
        case 'discount': return t('finder.reason.discount', { percent: r.percent, date: formatDate(isoToTashkentLocal(r.endsAt).slice(0, 10), lang) })
        case 'hours': return t('finder.reason.hours', { hours: fmtHours(r.hours, lang) })
        case 'selfPaced': return t('finder.reason.selfPaced')
        case 'seats': return t('finder.reason.seats', { n: r.left })
        case 'certificate': return t(`online.cert.${r.kind}` as TKey)
      }
    },
    [t, tr, lang, categories],
  )
  const warning = useCallback(
    (w: FinderWarning): string => {
      switch (w.code) {
        case 'overBudget': return t('finder.warn.overBudget', { price: formatSom(w.price, lang) })
        case 'overHours': return t('finder.warn.overHours', { hours: fmtHours(w.hours, lang) })
        case 'levelGap': return t('finder.warn.levelGap', { level: t(`level.${w.level}` as TKey) })
      }
    },
    [t, lang],
  )
  return { reason, warning }
}

function ReasonList({ match }: { match: FinderMatch<Course> }) {
  const { reason, warning } = useReasonText()
  return (
    <ul className="mt-3 space-y-1.5">
      {match.warnings.map((w) => (
        <li key={w.code} className="flex gap-2 text-xs font-medium text-amber-900">
          <Icon name="warn" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {warning(w)}
        </li>
      ))}
      {match.reasons.map((r, i) => (
        <li key={`${r.code}-${i}`} className="flex gap-2 text-xs leading-relaxed text-charcoal/70">
          <Icon name={REASON_ICON[r.code]} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" />
          {reason(r)}
        </li>
      ))}
    </ul>
  )
}

/** One suggested course: why it fits, its group and price, and add / open / save. */
function MatchCard({ match, inCart, onAdd }: { match: FinderMatch<Course>; inCart: boolean; onAdd: (m: FinderMatch<Course>) => void }) {
  const { t, tr } = useT()
  const c = match.course
  const category = useStore((s) => s.categories.find((x) => x.id === c.categoryId))
  const center = useStore((s) => s.centers.find((x) => x.id === c.centerId))
  const online = isOnlineCourse(c)
  const percent = activePercent(c)
  return (
    <article className="card group flex h-full flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:shadow-lift">
      <Link to={`/courses/${c.id}`} className="relative block overflow-hidden bg-sage/20" tabIndex={-1} aria-hidden="true">
        <div className="aspect-[16/7]">
          <img src={getCoursePhotoUrl(c)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-charcoal/65 via-charcoal/10 to-transparent" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <FormatBadge course={c} />
          {percent > 0 && <span className="rounded-full bg-champagne px-2 py-0.5 text-[11px] font-bold text-forest">−{percent}%</span>}
        </div>
        <span className={cx('absolute bottom-3 left-3 rounded-full px-2.5 py-0.5 text-[11px] font-semibold', match.fit === 'strong' ? 'bg-forest text-ivory' : 'bg-paper/90 text-charcoal')}>
          {t(match.fit === 'strong' ? 'finder.fit.strong' : 'finder.fit.good')}
        </span>
      </Link>
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-charcoal/50">{[tr(category?.name), online ? c.providerName : center?.name].filter(Boolean).join(' · ')}</div>
        <Link to={`/courses/${c.id}`} className="mt-1 font-display text-xl leading-snug text-charcoal hover:text-forest">{tr(c.title)}</Link>
        {match.group && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-charcoal/55">
            <ScheduleChips group={match.group} compact />
            <span>{match.group.name}</span>
          </div>
        )}
        <div className="mb-4"><ReasonList match={match} /></div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-charcoal/10 pt-3">
          <div className="text-sm font-medium text-charcoal">
            {online ? t('online.free') : <><PriceNow course={c} /> <span className="text-[10px] font-normal text-charcoal/45">{t('common.som')} {t('common.perMonth')}</span></>}
          </div>
          <div className="flex items-center gap-1.5">
            <SaveButton courseId={c.id} />
            {online ? (
              isSafeExternalUrl(c.externalUrl) && <LinkButton to={c.externalUrl as string} external size="sm">{t('online.open')} <Icon name="external" className="h-3.5 w-3.5" /></LinkButton>
            ) : (
              <Button size="sm" disabled={inCart} onClick={() => onAdd(match)}>
                <Icon name={inCart ? 'check' : 'cart'} className="h-3.5 w-3.5" />
                {inCart ? t('favorites.inCart') : t('favorites.addToCart')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

/** The suggested set: one group per course, the monthly total (with discounts shown), add to cart and save. */
function PlanCard({ plan, onAdd, onSave }: { plan: FinderPlan<Course>; onAdd: () => void; onSave?: () => void }) {
  const { t, tr, lang } = useT()
  const packages = useStore((s) => s.site.packages)
  const categories = useStore((s) => s.categories)
  const centers = useStore((s) => s.centers)
  const pkg = packages.find((p) => p.id === plan.packageId)
  const saving = plan.listTotal - plan.total
  return (
    <Card className="overflow-hidden" padded={false}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-charcoal/10 bg-sage/40 px-5 py-4 sm:px-6">
        <Badge tone="forest"><Icon name="layers" className="h-3 w-3" />{pkg ? tr(pkg.name) : t('builder.custom')}</Badge>
        <span className="text-xs text-charcoal/60">{plan.size > 1 ? t('finder.plan.hint') : countLabel(lang, 1, NOUNS.course)}</span>
      </div>
      <ul className="divide-y divide-charcoal/10 px-5 sm:px-6">
        {plan.items.map(({ course: c, group: g }) => (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-4">
            <div className="min-w-0 flex-1">
              <Link to={`/courses/${c.id}`} className="font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link>
              <div className="mt-0.5 text-[11px] text-charcoal/55">{[tr(categories.find((x) => x.id === c.categoryId)?.name), centers.find((x) => x.id === c.centerId)?.name, g.name].filter(Boolean).join(' · ')}</div>
              <div className="mt-1.5"><ScheduleChips group={g} compact /></div>
            </div>
            <div className="shrink-0 text-right text-sm font-medium text-charcoal">
              <PriceNow course={c} />
              <div className="text-[10px] font-normal text-charcoal/45">{t('common.som')} {t('common.perMonth')}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-5 border-t border-charcoal/10 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div>
          <div className="text-sm text-charcoal/60">{t('builder.monthlyTotal')}</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
            {saving > 0 && <span className="text-sm text-charcoal/45 line-through"><span className="sr-only">{t('discount.was')}: </span>{formatSom(plan.listTotal, lang)}</span>}
            <span className="font-display text-4xl text-charcoal">{formatSom(plan.total, lang)}</span>
          </div>
          {saving > 0 && <div className="mt-1 text-xs font-semibold text-forest">{t('finder.plan.saving', { price: formatSom(saving, lang) })}</div>}
          <div className="mt-1 text-[11px] text-charcoal/50">
            {fmtHours(plan.hours, lang)} {t('preview.hoursPerWeek')}
            {plan.size > 1 && <> · <Icon name="check" className="inline h-3 w-3 text-forest" /> {t('builder.noConflicts')}</>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onSave && <Button variant="secondary" onClick={onSave}><Icon name="bookmark" className="h-4 w-4" />{t('finder.plan.save')}</Button>}
          <Button onClick={onAdd}><Icon name="cart" className="h-4 w-4" />{t('finder.plan.add')}</Button>
        </div>
      </div>
    </Card>
  )
}

export function CourseFinderPage() {
  const { t, tr, lang } = useT()
  const [params, setParams] = useSearchParams()
  const hydrated = useHydrated()
  const canSave = useCanSaveCourses()
  const student = useCurrentStudent()
  const courses = useStore((s) => s.courses)
  const categories = useStore((s) => s.categories)
  const packages = useStore((s) => s.site.packages)
  const presets = useStore((s) => s.site.presets)
  const universities = useStore((s) => s.site.universities)
  const students = useStore((s) => s.students)
  const setBuilderPackage = useStore((s) => s.setBuilderPackage)
  const addBuilderGroup = useStore((s) => s.addBuilderGroup)
  const removeBuilderCourse = useStore((s) => s.removeBuilderCourse)
  const toggleSavedCourse = useStore((s) => s.toggleSavedCourse)
  const notify = useStore((s) => s.notify)

  // Only subjects that have something to offer right now.
  const subjects = useMemo(() => categories.filter((c) => courses.some((x) => x.categoryId === c.id && isPublicListed(x))), [categories, courses])
  const subjectIds = useMemo(() => subjects.map((c) => c.id), [subjects])

  const [answers, setAnswers] = useState<FinderAnswers>(DEFAULT_FINDER_ANSWERS)
  const [answered, setAnswered] = useState<QuestionId[]>([])
  const [step, setStep] = useState(0)
  const [size, setSize] = useState<number | null>(null)
  const [pending, setPending] = useState<FinderPlan<Course> | null>(null)
  const [added, setAdded] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const advanceTimer = useRef<number | undefined>(undefined)
  const moved = useRef(false)

  // A complete set of answers in the URL (a shared link) opens on the results; otherwise answers saved in this browser
  // are filled in. Runs once, after hydration, so the server render and the first client render match.
  const loaded = useRef(false)
  useEffect(() => {
    if (!hydrated || loaded.current) return
    loaded.current = true
    const fromUrl = finderAnswersFromParams(params, subjectIds)
    // A goal picked on the home page teaser (?goal=…) is pre-selected; answers saved in this browser are kept.
    const urlGoal = params.get('goal')
    if (!fromUrl.complete && urlGoal && fromUrl.answers.goal === urlGoal) {
      const stored = readStoredAnswers(subjectIds)
      setAnswers({ ...(stored ?? DEFAULT_FINDER_ANSWERS), goal: fromUrl.answers.goal })
      setAnswered(stored ? QUESTIONS : ['goal'])
      return
    }
    const restored = fromUrl.complete ? fromUrl.answers : readStoredAnswers(subjectIds)
    if (!restored) return
    setAnswers(restored)
    setAnswered(QUESTIONS)
    if (fromUrl.complete) setStep(RESULTS)
  }, [hydrated, params, subjectIds])

  useEffect(() => () => window.clearTimeout(advanceTimer.current), [])
  // Move focus to the new question so keyboard and screen-reader users follow the step change.
  useEffect(() => {
    if (!moved.current) return
    if (step < RESULTS) heading.current?.focus()
    else window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  const goTo = (n: number) => { window.clearTimeout(advanceTimer.current); moved.current = true; setStep(n) }
  const showResults = () => {
    setSize(null)
    setAdded(false)
    setParams(finderAnswersToParams(answers), { replace: true })
    goTo(RESULTS)
  }

  const choose = (q: QuestionId, value: string) => {
    setAnswers((a) => {
      switch (q) {
        case 'goal': return { ...a, goal: value as FinderGoal }
        case 'subject': return value === 'any' ? { ...a, categoryIds: [] } : { ...a, categoryIds: a.categoryIds.includes(value) ? a.categoryIds.filter((x) => x !== value) : [...a.categoryIds, value] }
        case 'level': return { ...a, level: value as FinderLevel }
        case 'format': return { ...a, format: value as FinderFormat }
        case 'budget': return { ...a, budget: value === 'any' ? 'any' : Number(value) }
        case 'hours': return { ...a, hours: value === 'any' ? 'any' : Number(value) }
      }
    })
    setAnswered((list) => (list.includes(q) ? list : [...list, q]))
    // Single-choice questions move on by themselves after a short pause; the subject question allows several answers.
    if (q !== 'subject' && step < RESULTS - 1) {
      window.clearTimeout(advanceTimer.current)
      advanceTimer.current = window.setTimeout(() => goTo(step + 1), 260)
    }
  }

  const options = (q: QuestionId): Option[] => {
    switch (q) {
      case 'goal':
        return (['university', 'ielts', 'career', 'personal'] as const).map((g) => ({ value: g, label: t(`finder.goal.${g}` as TKey), hint: t(`finder.goal.${g}.hint` as TKey), icon: { university: 'book', ielts: 'globe', career: 'layers', personal: 'star' }[g] }))
      case 'subject':
        return [{ value: 'any', label: t('finder.any'), icon: 'grid' }, ...subjects.map((c) => ({ value: c.id, label: tr(c.name), glyph: c.glyph }))]
      case 'level':
        return [...(['beginner', 'intermediate', 'advanced'] as const).map((l) => ({ value: l, label: t(`level.${l}` as TKey), hint: t(`finder.level.${l}.hint` as TKey), icon: 'layers' })), { value: 'any', label: t('finder.level.any'), icon: 'info' }]
      case 'format':
        return [
          { value: 'offline', label: t('format.badge.OFFLINE'), hint: t('finder.format.offline.hint'), icon: 'building' },
          { value: 'online', label: t('format.badge.ONLINE'), hint: t('finder.format.online.hint'), icon: 'globe' },
          { value: 'any', label: t('finder.any'), hint: t('finder.format.any.hint'), icon: 'grid' },
        ]
      case 'budget':
        return [
          ...FINDER_BUDGETS.map((b) => ({ value: String(b), label: b === 0 ? t('finder.budget.free') : t('finder.budget.upTo', { price: formatSom(b, lang) }), icon: 'check' })),
          { value: 'any', label: t('finder.noLimit'), icon: 'grid' },
        ]
      case 'hours':
        return [...FINDER_HOURS.map((h) => ({ value: String(h), label: t('finder.hours.upTo', { n: h }), icon: 'clock' })), { value: 'any', label: t('finder.noLimit'), icon: 'grid' }]
    }
  }
  const selectedValues = (q: QuestionId): string[] => {
    if (!answered.includes(q) && q !== 'subject') return []
    switch (q) {
      case 'goal': return [answers.goal]
      case 'subject': return answered.includes('subject') && answers.categoryIds.length === 0 ? ['any'] : answers.categoryIds
      case 'level': return [answers.level]
      case 'format': return [answers.format]
      case 'budget': return [String(answers.budget)]
      case 'hours': return [String(answers.hours)]
    }
  }
  const QUESTION_TEXT: Record<QuestionId, { title: TKey; hint?: TKey }> = {
    goal: { title: 'finder.q.goal' },
    subject: { title: 'finder.q.subject', hint: 'finder.multi' },
    level: { title: 'finder.q.level' },
    format: { title: 'finder.q.format' },
    budget: { title: 'finder.q.budget', hint: 'finder.budget.hint' },
    hours: { title: 'finder.q.hours', hint: 'finder.hours.hint' },
  }
  const answerLabel = (q: QuestionId): string => {
    const values = selectedValues(q)
    if (values.length === 0) return '—'
    const opts = options(q)
    return values.map((v) => opts.find((o) => o.value === v)?.label ?? '').filter(Boolean).join(', ')
  }

  const result = useMemo(
    () => (step === RESULTS ? recommendCourses({ answers, courses, categories, packages, presets, seatsLeft: (g) => seatsLeft(g, students, student?.id) }) : null),
    [step, answers, courses, categories, packages, presets, students, student?.id],
  )
  const plan = result ? result.plans.find((p) => p.size === size) ?? result.plans.find((p) => p.size === result.recommendedSize) ?? null : null

  const cartGroupIds = hydrated ? student?.builder.groupIds ?? [] : []
  const inCart = (c: Course) => c.groups.some((g) => cartGroupIds.includes(g.id))
  const currentPkg = packages.find((p) => p.id === student?.builder.packageId)
  const builderMessage = (r: Extract<BuilderResult, { ok: false }>): string =>
    ({
      'no-package': t('builder.pickPackageFirst'),
      limit: currentPkg ? t('builder.limitReached') : t('builder.customLimit', { n: MAX_CART_COURSES }),
      duplicate: t('builder.duplicate'),
      conflict: `${t('builder.conflict')} — ${tr(courses.find((c) => c.id === r.conflictWith)?.title)}. ${t('builder.conflictHint')}`,
      disabled: t('builder.packageDisabled'),
      full: `${t('capacity.full')} — ${t('capacity.fullHint')}`,
    })[r.reason]

  const addCourse = (m: FinderMatch<Course>) => {
    if (!student || !m.group) return
    const r = addBuilderGroup(student.id, m.group.id)
    if (r.ok) notify(t('courses.inPlan'))
    else notify(builderMessage(r), 'warn')
  }

  // A set replaces the cart (after a confirmation when the cart is not empty), then goes in through the regular cart rules.
  const applyPlan = (p: FinderPlan<Course>) => {
    setPending(null)
    if (!student) return
    const current = courses.filter((c) => c.groups.some((g) => student.builder.groupIds.includes(g.id)))
    for (const c of current) removeBuilderCourse(student.id, c.id)
    setBuilderPackage(student.id, p.packageId)
    for (const { group } of p.items) {
      const r = addBuilderGroup(student.id, group.id)
      if (!r.ok) { notify(`${t('finder.plan.failed')} ${builderMessage(r)}`, 'warn'); return }
    }
    setAdded(true)
    notify(t('finder.plan.added'))
  }
  const requestPlan = (p: FinderPlan<Course>) => {
    if (!student) return
    const ids = student.builder.groupIds
    if ((student.builder.packageId ?? null) === p.packageId && ids.length === p.items.length && p.items.every((it) => ids.includes(it.group.id))) { notify(t('preset.allInCart')); return }
    if (ids.length > 0) setPending(p)
    else applyPlan(p)
  }
  const savePlan = (p: FinderPlan<Course>) => {
    if (!student) return
    for (const { course } of p.items) if (!student.savedCourseIds.includes(course.id)) toggleSavedCourse(student.id, course.id)
    writeStoredAnswers(answers)
    notify(t('finder.plan.saved'))
  }
  const saveAnswers = () => {
    const ok = writeStoredAnswers(answers)
    notify(ok ? t('finder.answersSaved') : t('finder.answersNotSaved'), ok ? 'ok' : 'warn')
  }
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      notify(t('common.copied'))
    } catch {
      notify(window.location.href)
    }
  }
  const restart = () => {
    setAnswers(DEFAULT_FINDER_ANSWERS)
    setAnswered([])
    setParams({}, { replace: true })
    goTo(0)
  }

  const q = QUESTIONS[Math.min(step, RESULTS - 1)]
  const canNext = q === 'subject' || answered.includes(q)
  const pendingCount = student ? courses.filter((c) => c.groups.some((g) => student.builder.groupIds.includes(g.id))).length : 0

  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle eyebrow={t('finder.eyebrow')} title={t('finder.title')} subtitle={t('finder.subtitle')} />

      {step < RESULTS ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px] lg:gap-8">
          <Card className="p-5 sm:p-8">
            <div className="flex items-center justify-between gap-3 text-xs font-medium text-charcoal/55">
              <span>{t('finder.step', { n: step + 1, total: RESULTS })}</span>
              <span className="tabular-nums">{Math.round(((step + 1) / RESULTS) * 100)}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-charcoal/10" aria-hidden="true">
              <div className="h-full rounded-full bg-forest transition-[width] duration-500 ease-out" style={{ width: `${((step + 1) / RESULTS) * 100}%` }} />
            </div>

            <div key={step} className="page-in mt-7">
              <h2 ref={heading} tabIndex={-1} className="font-display text-3xl leading-tight text-charcoal outline-none sm:text-4xl">{t(QUESTION_TEXT[q].title)}</h2>
              {QUESTION_TEXT[q].hint && <p className="mt-2 text-sm text-charcoal/60">{t(QUESTION_TEXT[q].hint!)}</p>}
              {/* The four goals stay a balanced 2x2 grid at every width (icon above the label on phones). */}
              <div role="group" aria-label={t(QUESTION_TEXT[q].title)} className={cx('mt-6 grid gap-2.5 sm:gap-3', q === 'goal' ? 'max-w-[44rem] grid-cols-2' : q === 'subject' ? 'grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2')}>
                {options(q).map((o) => {
                  const on = selectedValues(q).includes(o.value)
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => choose(q, o.value)}
                      className={cx(
                        'relative flex gap-2.5 rounded-2xl border bg-paper p-3 text-left shadow-[0_1px_2px_rgba(32,39,37,0.05),0_8px_20px_-14px_rgba(22,60,53,0.35)] transition duration-300 ease-out hover:-translate-y-1 hover:border-forest/40 hover:shadow-soft motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                        // On phones a goal tile puts its icon and tick on one row, so the label can use the full width.
                        q === 'goal' ? 'flex-col items-start sm:flex-row sm:pr-10' : 'items-start pr-9 sm:pr-10',
                        on ? 'finder-choice-on border-forest bg-sage/40' : 'border-charcoal/10',
                      )}
                    >
                      <span aria-hidden="true" className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-display text-base transition-colors duration-300', on ? 'bg-forest text-ivory' : 'bg-sage/70 text-forest')}>
                        {o.glyph ?? <Icon name={o.icon ?? 'check'} className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium leading-snug text-charcoal">{o.label}</span>
                        {o.hint && <span className="mt-0.5 block text-xs leading-relaxed text-charcoal/55">{o.hint}</span>}
                      </span>
                      <span className={cx('absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition-colors', on ? 'border-forest bg-forest text-ivory' : 'border-charcoal/20 bg-paper')}>{on && <Icon name="check" className="h-3 w-3" />}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between gap-3 border-t border-charcoal/10 pt-5">
              <Button variant="ghost" disabled={step === 0} onClick={() => goTo(step - 1)}><Icon name="arrowLeft" className="h-4 w-4" />{t('common.back')}</Button>
              {step === RESULTS - 1 ? (
                <Button disabled={!canNext} onClick={showResults}>{t('finder.showResults')} <Icon name="arrowRight" className="h-4 w-4" /></Button>
              ) : (
                <Button variant="secondary" disabled={!canNext} onClick={() => goTo(step + 1)}>{t('common.next')} <Icon name="arrowRight" className="h-4 w-4" /></Button>
              )}
            </div>
          </Card>

          <aside className="min-w-0">
            <Card className="hidden p-5 lg:block">
              <Eyebrow className="mb-3">{t('finder.yourAnswers')}</Eyebrow>
              <ol className="space-y-1">
                {QUESTIONS.map((id, i) => (
                  <li key={id}>
                    <button type="button" onClick={() => goTo(i)} aria-current={i === step ? 'step' : undefined} className={cx('flex w-full items-start gap-3 rounded-control px-2 py-2 text-left transition hover:bg-sage/40', i === step && 'bg-sage/50')}>
                      <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold', answered.includes(id) ? 'bg-forest text-ivory' : 'border border-charcoal/20 text-charcoal/50')}>{answered.includes(id) ? <Icon name="check" className="h-3 w-3" /> : i + 1}</span>
                      <span className="min-w-0">
                        <span className="block text-xs text-charcoal/55">{t(QUESTION_TEXT[id].title)}</span>
                        <span className="block truncate text-sm font-medium text-charcoal">{answered.includes(id) ? answerLabel(id) : '—'}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </Card>
            <p className="text-xs leading-relaxed text-charcoal/55 lg:mt-4">{t('finder.basis')}</p>
          </aside>
        </div>
      ) : (
        result && (
          <div className="page-in">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <Eyebrow>{t('finder.results.title')}</Eyebrow>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {QUESTIONS.map((id, i) => (
                    <li key={id}>
                      <button type="button" onClick={() => goTo(i)} title={t(QUESTION_TEXT[id].title)} className="inline-flex max-w-full items-center gap-1 rounded-full border border-forest/15 bg-sage/50 px-2.5 py-1 text-xs font-medium text-forest transition hover:border-forest/40">
                        <span className="truncate">{answerLabel(id)}</span>
                        <Icon name="edit" className="h-3 w-3 shrink-0 opacity-60" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => goTo(0)}><Icon name="edit" className="h-3.5 w-3.5" />{t('finder.edit')}</Button>
                <Button size="sm" variant="secondary" onClick={saveAnswers}><Icon name="bookmark" className="h-3.5 w-3.5" />{t('finder.saveAnswers')}</Button>
                <Button size="sm" variant="ghost" onClick={copyLink}><Icon name="external" className="h-3.5 w-3.5" />{t('common.copyLink')}</Button>
                <Button size="sm" variant="ghost" onClick={restart}><Icon name="refresh" className="h-3.5 w-3.5" />{t('finder.restart')}</Button>
              </div>
            </div>

            {result.matches.length === 0 && result.nearby.length === 0 && result.presets.length === 0 ? (
              <div className="mt-10">
                <EmptyState icon={<Icon name="search" className="h-7 w-7" />} title={t('finder.empty.title')} body={t('finder.empty.body')} action={<Button onClick={() => goTo(0)}>{t('finder.edit')}</Button>} />
              </div>
            ) : (
              <>
                {plan ? (
                  <section className="mt-10" aria-labelledby="finder-plan">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <h2 id="finder-plan" className="font-display text-3xl text-charcoal">{t('finder.plan.title')}</h2>
                      {result.plans.length > 1 && (
                        <div role="group" aria-label={t('finder.plan.sizes')}>
                          <Segmented size="sm" options={result.plans.map((p) => ({ id: String(p.size), label: countLabel(lang, p.size, NOUNS.course) }))} value={String(plan.size)} onChange={(v) => { setSize(Number(v)); setAdded(false) }} />
                        </div>
                      )}
                    </div>
                    <PlanCard plan={plan} onAdd={() => requestPlan(plan)} onSave={canSave ? () => savePlan(plan) : undefined} />
                    {added && (
                      <Notice tone="ok" className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />{t('finder.plan.added')}</span>
                        <Link to="/builder" className="font-medium text-forest underline">{t('builder.continue')}</Link>
                      </Notice>
                    )}
                  </section>
                ) : (
                  answers.format !== 'online' && answers.budget !== 0 && <Notice tone="info" className="mt-10">{t('finder.plan.none')}</Notice>
                )}

                {result.presets.length > 0 && (
                  <section className="mt-12" aria-labelledby="finder-uni">
                    <h2 id="finder-uni" className="mb-4 font-display text-3xl text-charcoal">{t('uni.title')}</h2>
                    <div className="grid gap-4 md:grid-cols-3">
                      {result.presets.map(({ preset, total, withinBudget }) => {
                        const uni = universityOf(preset, universities ?? [])
                        return (
                          <Card key={preset.id} className="flex flex-col p-5">
                            {uni && <div className="eyebrow">{isPreparationTrack(uni) ? universityName(uni, lang) : uni.shortName || uni.name}</div>}
                            <div className="mt-1 font-display text-2xl leading-tight text-charcoal">{tr(preset.name)}</div>
                            {tr(preset.program) && <div className="mt-1 text-sm font-medium text-forest">{tr(preset.program)}</div>}
                            <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">
                              <div>
                                <div className="font-display text-xl text-charcoal">{formatSom(total, lang)} <span className="text-[11px] font-body text-charcoal/50">{t('common.perMonth')}</span></div>
                                {!withinBudget && <Badge tone="warn" className="mt-1">{t('finder.uni.overBudget')}</Badge>}
                              </div>
                              <LinkButton size="sm" variant="secondary" to={uni ? `/builder?uni=${encodeURIComponent(uni.id)}` : '/builder'}>{t('finder.uni.open')} <Icon name="arrowRight" className="h-3.5 w-3.5" /></LinkButton>
                            </div>
                          </Card>
                        )
                      })}
                    </div>
                  </section>
                )}

                {result.matches.length > 0 && (
                  <section className="mt-12" aria-labelledby="finder-matches">
                    <h2 id="finder-matches" className="mb-4 font-display text-3xl text-charcoal">{t('finder.courses.title')}</h2>
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {result.matches.map((m) => <MatchCard key={m.course.id} match={m} inCart={inCart(m.course)} onAdd={addCourse} />)}
                    </div>
                  </section>
                )}

                {result.nearby.length > 0 && (
                  <section className="mt-12" aria-labelledby="finder-nearby">
                    <h2 id="finder-nearby" className="font-display text-2xl text-charcoal">{t('finder.nearby.title')}</h2>
                    <p className="mb-4 mt-1 text-sm text-charcoal/60">{t('finder.nearby.hint')}</p>
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {result.nearby.map((m) => <MatchCard key={m.course.id} match={m} inCart={inCart(m.course)} onAdd={addCourse} />)}
                    </div>
                  </section>
                )}
              </>
            )}
            <p className="mt-12 max-w-2xl text-xs leading-relaxed text-charcoal/55">{t('finder.basis')}</p>
          </div>
        )
      )}

      <Modal
        closeOnBackdrop
        open={!!pending}
        onClose={() => setPending(null)}
        title={t('finder.replace.title')}
        footer={<><Button variant="ghost" onClick={() => setPending(null)}>{t('common.cancel')}</Button><Button onClick={() => pending && applyPlan(pending)}>{t('finder.replace.confirm')}</Button></>}
      >
        <p className="text-sm text-charcoal/70">{t('finder.replace.body', { n: countLabel(lang, pendingCount, NOUNS.course) })}</p>
      </Modal>
    </div>
  )
}

/** Home page teaser for "My set" (section type `courseFinder`); the Super Admin adds, moves or hides it under Pages. */
export function CourseFinderTeaser({ s }: { s: Section }) {
  const { t, tr } = useT()
  const goals: FinderGoal[] = ['university', 'ielts', 'career', 'personal']
  // The highlighted goal follows the pointer and keyboard focus; each tile opens the finder with that goal chosen.
  const [active, setActive] = useState(0)
  return (
    <section className="container-x py-16 lg:py-24">
      <div className="reveal reveal-scale relative overflow-hidden rounded-card border border-charcoal/10 bg-gradient-to-br from-paper via-ivory to-sage/50 px-6 py-12 sm:px-10 md:px-14 md:py-16">
        <div className="float-a pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full border border-champagne/40" aria-hidden="true" />
        <div className="float-b pointer-events-none absolute -bottom-24 right-24 h-64 w-64 rounded-full border border-forest/10" aria-hidden="true" />
        <div className="relative grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
          <div>
            <Eyebrow>{t('finder.eyebrow')}</Eyebrow>
            <h2 className="mt-3 font-display text-4xl leading-tight text-charcoal md:text-5xl">{tr(s.title) || t('finder.title')}</h2>
            <p className="mt-4 max-w-lg text-charcoal/70">{tr(s.subtitle) || t('finder.teaser.body')}</p>
            <ul className="mt-6 space-y-2 text-sm text-charcoal/75">
              {(['finder.teaser.p1', 'finder.teaser.p2', 'finder.teaser.p3'] as const).map((k) => (
                <li key={k} className="flex gap-2.5"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-forest" />{t(k)}</li>
              ))}
            </ul>
            <LinkButton to="/course-finder" size="lg" className="mt-8">{t('finder.teaser.cta')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
          </div>
          {/* The first question of the finder: four goals in a balanced 2x2 grid that open the finder with the goal chosen. */}
          <div className="reveal-stagger grid w-full auto-rows-fr grid-cols-2 gap-3 sm:gap-4" onMouseLeave={() => setActive(0)}>
            {goals.map((g, i) => {
              const on = i === active
              const icon = { university: 'cap', ielts: 'chat', career: 'briefcase', personal: 'sparkle' }[g]
              return (
                <Link
                  key={g}
                  to={`/course-finder?goal=${g}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  className={cx(
                    'reveal group relative flex min-h-[11rem] min-w-0 flex-col overflow-hidden rounded-card border bg-paper p-4 shadow-soft transition duration-500 ease-[var(--ease-out-soft)] hover:-translate-y-1 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 sm:min-h-[12rem] sm:p-5',
                    on ? 'finder-choice-on border-forest/60' : 'border-charcoal/10',
                  )}
                >
                  {/* The goal's icon, large and faint, in the corner of the card. */}
                  <span aria-hidden="true" className={cx('pointer-events-none absolute -bottom-5 -right-5 transition duration-500', on ? 'scale-110 text-champagne/30' : 'text-forest/[0.06]')}>
                    <Icon name={icon} className="h-20 w-20 sm:h-28 sm:w-28" />
                  </span>
                  <span aria-hidden="true" className={cx('relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-4 transition-colors duration-300', on ? 'bg-forest text-champagne ring-champagne/25' : 'bg-sage/70 text-forest ring-sage/30')}>
                    <Icon name={icon} className="h-5 w-5" />
                  </span>
                  <span className="relative mt-4 font-display text-lg leading-[1.15] text-charcoal sm:text-[1.35rem]">{t(`finder.goal.${g}` as TKey)}</span>
                  <span className="relative mt-1.5 text-xs leading-relaxed text-charcoal/60">{t(`finder.goal.${g}.hint` as TKey)}</span>
                  <span aria-hidden="true" className={cx('absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full transition duration-300 sm:right-5 sm:top-5', on ? 'bg-forest text-ivory' : 'text-charcoal/30')}>
                    <Icon name="arrowRight" className="h-3.5 w-3.5" />
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

/** One-line invitation to "My set", shown where students pick courses (catalog, builder). */
export function CourseFinderPrompt({ className }: { className?: string }) {
  const { t } = useT()
  return (
    <div className={cx('flex flex-col gap-3 rounded-card border border-champagne/50 bg-gradient-to-r from-champagne/15 via-paper to-sage/40 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5', className)}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-forest text-ivory"><Icon name="layers" className="h-4 w-4" /></span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-charcoal">{t('finder.prompt')}</div>
          <div className="text-xs text-charcoal/60">{t('finder.teaser.body')}</div>
        </div>
      </div>
      <LinkButton to="/course-finder" size="sm" variant="secondary" className="shrink-0 self-start sm:self-auto">{t('finder.title')} <Icon name="arrowRight" className="h-3.5 w-3.5" /></LinkButton>
    </div>
  )
}
