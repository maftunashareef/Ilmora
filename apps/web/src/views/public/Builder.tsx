import { useEffect, useMemo, useRef, useState } from 'react'
import { countLabel, foldForSearch, isOnlineCourse, MAX_CART_COURSES, NOUNS, presetCartPlan, priceTotals } from '@ilmora/shared'
import { Link, useNavigate, useSearchParams } from '@/lib/router'
import { PriceNow, ScheduleChips, TotalPrice } from '../../components/course/CourseCard'
import { Timetable } from '../../components/Timetable'
import { ArtCover, Badge, Button, Card, cx, Eyebrow, Icon, Input, Modal, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isPublicListed } from '../../lib/access'
import { UniversityPackagesSection } from './UniversityPackages'
import { CourseFinderPrompt } from './CourseFinder'
import { JourneyTracker } from '../../components/JourneySteps'
import { enrolledCount, isGroupFull } from '../../lib/enrollment'
import { findConflicts, overlaps, resolveGroups, weeklyHours } from '../../lib/schedule'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Course, Preset } from '../../types'

export function BuilderPage() {
  const { t, tr, lang } = useT()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const student = useCurrentStudent()
  const packages = useStore((s) => s.site.packages)
  const courses = useStore((s) => s.courses)
  const categories = useStore((s) => s.categories)
  const centers = useStore((s) => s.centers)
  const teachers = useStore((s) => s.teachers)
  const students = useStore((s) => s.students)
  const setBuilderPackage = useStore((s) => s.setBuilderPackage)
  const addBuilderGroup = useStore((s) => s.addBuilderGroup)
  const removeBuilderCourse = useStore((s) => s.removeBuilderCourse)
  const notify = useStore((s) => s.notify)
  const guestHydrated = useStore((s) => s.guestHydrated)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [picker, setPicker] = useState<Course | null>(null)
  // Courses of an added preset that still need a group choice, in order; the group picker walks through them.
  const [queue, setQueue] = useState<Course[]>([])
  const presets = useStore((s) => s.site.presets)
  const universities = useStore((s) => s.site.universities)

  // ?package=… (from a package card) is applied once per link, and only after a visitor's saved cart has been read from
  // the device, so it switches the package without wiping the chosen courses. Afterwards the student's own choice with
  // the package buttons wins (re-applying it on every change used to snap the package back to the one in the link).
  const appliedPackageParam = useRef<string | null>(null)
  useEffect(() => {
    const p = params.get('package')
    if (!p || !student || !guestHydrated || appliedPackageParam.current === p) return
    // ?package=custom is "Build Your Own" (no package); any other value must be an enabled package.
    if (p === 'custom') {
      appliedPackageParam.current = p
      if (student.builder.packageId !== null) setBuilderPackage(student.id, null)
    } else if (packages.some((x) => x.id === p && x.enabled)) {
      appliedPackageParam.current = p
      if (student.builder.packageId !== p) setBuilderPackage(student.id, p)
    }
  }, [params, student, packages, setBuilderPackage, guestHydrated])

  const pkg = packages.find((p) => p.id === student?.builder.packageId)
  const selectedGroups = useMemo(() => resolveGroups(student?.builder.groupIds ?? [], courses), [student, courses])
  const conflicts = findConflicts(selectedGroups)
  const totals = priceTotals(selectedGroups.map((g) => courses.find((x) => x.id === g.courseId)).filter((c): c is Course => !!c))
  // Only offline courses (groups with seats and a schedule) can be put in a subscription; online courses open on the provider's site.
  const publicCourses = courses.filter((c) => isPublicListed(c) && !isOnlineCourse(c))
  const list = publicCourses.filter((c) => (!cat || c.categoryId === cat) && (!q || foldForSearch(`${tr(c.title)} ${teachers.find((x) => x.id === c.teacherId)?.name ?? ''}`).includes(foldForSearch(q.trim()))))
  const selectedCourseIds = new Set(selectedGroups.map((g) => g.courseId))
  // Without a package this is a custom selection: any number of courses from one up to the cart limit.
  const maxSelectable = pkg?.maxCourses ?? MAX_CART_COURSES
  const complete = (pkg ? selectedGroups.length === pkg.maxCourses : selectedGroups.length >= 1) && conflicts.length === 0
  // How It Works tracker: courses chosen, the package's course count met, the selection checked (no clashes); then review.
  // The six steps of "How ILMORA works": browse, choose, package, price, cart (review and payment), learn.
  const hasCourses = selectedGroups.length > 0
  const journeyDone = [hasCourses, hasCourses, pkg ? selectedGroups.length === pkg.maxCourses : hasCourses, complete, false, false]
  const journeyCurrent = Math.min(journeyDone.indexOf(false), 4)
  const goToStep = (step: number) => {
    if (step === 0) { nav('/courses'); return }
    if (step === 4) { if (complete) nav('/preview'); return }
    document.getElementById(['', 'builder-courses', 'builder-packages', 'builder-summary'][step])?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tryAdd = (groupId: string) => {
    if (!student) return
    const r = addBuilderGroup(student.id, groupId)
    if (r.ok) { notify(t('courses.inPlan')); setPicker(queue[0] ?? null); setQueue(queue.slice(1)); return }
    const conflictName = r.conflictWith ? tr(courses.find((c) => c.id === r.conflictWith)?.title) : ''
    const msg = { 'no-package': t('builder.pickPackageFirst'), limit: pkg ? t('builder.limitReached') : t('builder.customLimit', { n: MAX_CART_COURSES }), duplicate: t('builder.duplicate'), conflict: `${t('builder.conflict')} — ${conflictName}. ${t('builder.conflictHint')}`, disabled: t('builder.packageDisabled'), full: `${t('capacity.full')} — ${t('capacity.fullHint')}` }[r.reason]
    notify(msg, 'warn')
  }
  const onAddCourse = (c: Course) => {
    if (selectedCourseIds.has(c.id)) { notify(t('builder.duplicate'), 'warn'); return }
    if (c.groups.length === 1) tryAdd(c.groups[0].id)
    else setPicker(c)
  }

  // Adds the courses of a ready-made preset to the same cart: regular validation, no duplicates, nothing added half-way.
  const startPreset = (preset: Preset) => {
    if (!student) return
    const plan = presetCartPlan(preset, courses, student.builder.groupIds)
    if (plan.toAdd.length === 0) { notify(t('preset.allInCart')); return }
    if (selectedGroups.length + plan.toAdd.length > maxSelectable) { notify(pkg ? t('builder.limitReached') : t('builder.customLimit', { n: MAX_CART_COURSES }), 'warn'); return }
    // Courses with a single group can be checked up front; if one would clash or is full, nothing is added.
    const fixed = plan.toAdd.filter((c) => c.groups.length === 1).map((c) => c.groups[0])
    if (findConflicts([...selectedGroups, ...fixed]).length > 0 || fixed.some((g) => isGroupFull(g, students, student.id))) { notify(t('preset.cannotAdd'), 'warn'); return }
    const pending: Course[] = []
    for (const c of plan.toAdd) {
      if (c.groups.length > 1) { pending.push(c); continue }
      if (!addBuilderGroup(student.id, c.groups[0].id).ok) { notify(t('preset.cannotAdd'), 'warn'); return }
    }
    if (plan.inCart.length > 0) notify(t('preset.skipped'))
    if (pending.length > 0) { setQueue(pending.slice(1)); setPicker(pending[0]) } else notify(t('preset.added'))
  }

  // /builder?add=<courseId> (from the saved courses page) adds that course once, opening the group picker when it has several.
  const handledAdd = useRef<string | null>(null)
  useEffect(() => {
    const id = params.get('add')
    if (!id || !student || handledAdd.current === id) return
    const c = courses.find((x) => x.id === id && isPublicListed(x))
    if (!c) return
    handledAdd.current = id
    onAddCourse(c)
  }, [params, student, courses, onAddCourse]) // onAddCourse is new every render; handledAdd makes this run once per link

  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle title={t('builder.title')} subtitle={t('builder.subtitle')} />
      <JourneyTracker done={journeyDone} current={journeyCurrent} canReview={complete} onStep={goToStep} />
      <CourseFinderPrompt className="mb-10" />

      {/* Step 1 — package */}
      <section id="builder-packages" className="mb-10 scroll-mt-24">
        <Eyebrow className="mb-4">{t('builder.step1')}</Eyebrow>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p) => {
            const active = pkg?.id === p.id
            return (
              <button key={p.id} type="button" disabled={!p.enabled} aria-pressed={active} onClick={() => { if (student) { if (p.maxCourses < selectedGroups.length) notify(t('builder.switchPackageWarn'), 'warn'); setBuilderPackage(student.id, p.id) } }} className={cx('card flex items-start justify-between gap-3 p-5 text-left transition disabled:opacity-40', active ? 'ring-inset-forest border-forest bg-sage/40' : 'hover:border-forest/40')}>
                <div>
                  <div className="font-display text-3xl text-charcoal">{tr(p.name)}</div>
                  <div className="text-xs text-charcoal/55">{t('builder.simultaneous', { n: p.maxCourses })}</div>
                  <p className="mt-2 text-sm text-charcoal/65">{tr(p.description)}</p>
                  {!p.enabled && <div className="mt-2 text-xs text-amber-800">{t('builder.packageDisabled')}</div>}
                </div>
                <span className={cx('mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', active ? 'border-forest bg-forest text-ivory' : 'border-charcoal/20')}>{active && <Icon name="check" className="h-3.5 w-3.5" />}</span>
              </button>
            )
          })}
          <button type="button" aria-pressed={!pkg} onClick={() => { if (student) setBuilderPackage(student.id, null) }} className={cx('card flex items-start justify-between gap-3 p-5 text-left transition', !pkg ? 'ring-inset-forest border-forest bg-sage/40' : 'hover:border-forest/40')}>
            <div>
              <div className="font-display text-3xl text-charcoal">{t('builder.custom')}</div>
              <p className="mt-2 text-sm text-charcoal/65">{t('builder.customHint', { n: MAX_CART_COURSES })}</p>
            </div>
            <span className={cx('mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', !pkg ? 'border-forest bg-forest text-ivory' : 'border-charcoal/20')}>{!pkg && <Icon name="check" className="h-3.5 w-3.5" />}</span>
          </button>
        </div>
      </section>

      {/* Ready-made packages next to Flex, Winx and Build Your Own: university preparation packages (published ones only). */}
      <UniversityPackagesSection presets={presets ?? []} universities={universities ?? []} courses={courses} cartGroupIds={student?.builder.groupIds ?? []} onAdd={startPreset} />

      <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
        {/* Step 2 — courses */}
        <section id="builder-courses" className="min-w-0 scroll-mt-24">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Eyebrow>{t('builder.step2')}</Eyebrow>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1 sm:flex-none"><Icon name="search" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-charcoal/40" /><Input aria-label={t('common.search')} className="w-full pl-9 py-2 sm:w-48" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="w-36 shrink-0 sm:w-44"><Select aria-label={t('common.category')} className="py-2" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">{t('common.all')}</option>{categories.map((c) => <option key={c.id} value={c.id}>{tr(c.name)}</option>)}</Select></div>
            </div>
          </div>
          {!pkg && <Notice tone="info" className="mb-4">{t('builder.customHint', { n: MAX_CART_COURSES })}</Notice>}
          <ul className="space-y-2">
            {list.map((c) => {
              const selected = selectedCourseIds.has(c.id)
              const g = selectedGroups.find((x) => x.courseId === c.id)
              const clashes = !selected && c.groups.every((cg) => selectedGroups.some((sg) => overlaps(cg, sg)))
              const limit = !selected && selectedGroups.length >= maxSelectable
              const allFull = !selected && c.groups.every((cg) => isGroupFull(cg, students, student?.id))
              const center = centers.find((x) => x.id === c.centerId)
              return (
                <li key={c.id} className={cx('card flex flex-wrap items-center gap-x-4 gap-y-3 p-3 transition sm:flex-nowrap', selected && 'border-forest/50 bg-sage/30')}>
                  <ArtCover seed={c.coverSeed} tone={center?.tone} imageUrl={c.imageUpload?.previewUrl || c.imageUrl} className="hidden h-16 w-24 shrink-0 rounded-control sm:block" />
                  <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/courses/${c.id}`} className="truncate font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link>
                      <Badge tone="muted">{tr(categories.find((x) => x.id === c.categoryId)?.name)}</Badge>
                      {clashes && <Badge tone="danger"><Icon name="warn" className="h-3 w-3" />{t('builder.conflict')}</Badge>}
                      {allFull && <Badge tone="warn">{t('capacity.full')}</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal/55">
                      <span>{center?.name}</span>
                      {g ? <ScheduleChips group={g} compact /> : <ScheduleChips group={c.groups[0]} compact />}
                      {c.groups.length > 1 && !g && <span className="text-charcoal/40">+{countLabel(lang, c.groups.length - 1, NOUNS.group)}</span>}
                    </div>
                  </div>
                  <div className="mr-auto shrink-0 sm:mr-0 sm:text-right">
                    <div className="text-sm font-medium text-charcoal"><PriceNow course={c} /></div>
                    <div className="text-[10px] text-charcoal/45">{t('common.som')} {t('common.perMonth')}</div>
                  </div>
                  {selected ? (
                    <div className="flex shrink-0 gap-1">
                      {c.groups.length > 1 && <Button size="sm" variant="ghost" onClick={() => setPicker(c)} aria-label={t('builder.changeGroup')}><Icon name="refresh" className="h-3.5 w-3.5" /></Button>}
                      <Button size="sm" variant="secondary" onClick={() => student && removeBuilderCourse(student.id, c.id)}><Icon name="x" className="h-3.5 w-3.5" />{t('common.remove')}</Button>
                    </div>
                  ) : (
                    <Button size="sm" disabled={limit || allFull} title={limit ? (pkg ? t('builder.limitReached') : t('builder.customLimit', { n: MAX_CART_COURSES })) : allFull ? t('capacity.fullHint') : undefined} onClick={() => onAddCourse(c)}><Icon name="plus" className="h-3.5 w-3.5" />{t('common.add')}</Button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {/* Summary */}
        <aside id="builder-summary" className="min-w-0 scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <Eyebrow>{t('builder.yourSelection')}</Eyebrow>
              {pkg ? <Badge tone="sage">{tr(pkg.name)} · {selectedGroups.length}/{pkg.maxCourses}</Badge> : <Badge tone="sage">{t('builder.custom')} · {selectedGroups.length}</Badge>}
            </div>
            {pkg && (
              <div className="mt-3 flex gap-1.5">
                {Array.from({ length: pkg.maxCourses }).map((_, i) => <span key={i} className={cx('h-1.5 flex-1 rounded-full', i < selectedGroups.length ? 'bg-forest' : 'bg-charcoal/10')} />)}
              </div>
            )}
            {selectedGroups.length === 0 ? (
              <p className="mt-5 text-sm text-charcoal/55">{t('builder.emptySelection')}</p>
            ) : (
              <ul className="mt-5 divide-y divide-charcoal/10">
                {selectedGroups.map((g) => {
                  const c = courses.find((x) => x.id === g.courseId)!
                  const clash = conflicts.some((k) => k.a.id === g.id || k.b.id === g.id)
                  return (
                    <li key={g.id} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-charcoal">{tr(c.title)}</div>
                        <div className="mt-0.5 text-[11px] text-charcoal/55">{g.name}</div>
                        <div className="mt-1"><ScheduleChips group={g} compact /></div>
                        {clash && <div className="mt-1 text-[11px] text-red-700">{t('builder.conflict')}</div>}
                      </div>
                      <div className="text-right text-sm text-charcoal"><PriceNow course={c} /></div>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="mt-4 border-t border-charcoal/10 pt-4">
              <div className="flex items-end justify-between gap-3">
                <span className="pb-1 text-sm text-charcoal/60">{t('builder.monthlyTotal')}</span>
                <TotalPrice list={totals.list} final={totals.final} />
              </div>
              <p className="mt-2 text-[11px] text-charcoal/45">{t('builder.transparent')}</p>
              {selectedGroups.length > 0 && <p className="mt-1 text-[11px] text-charcoal/45">{weeklyHours(selectedGroups)} {t('preview.hoursPerWeek')}</p>}
            </div>
            <div className="mt-4 space-y-2">
              {conflicts.length > 0 && <Notice tone="warn"><Icon name="warn" className="mr-1 inline h-3.5 w-3.5" />{t('builder.conflictHint')}</Notice>}
              {conflicts.length === 0 && selectedGroups.length > 1 && <Notice tone="info"><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />{t('builder.noConflicts')}</Notice>}
              {pkg && selectedGroups.length !== pkg.maxCourses && <p className="text-xs text-charcoal/55">{t('builder.needExactly', { n: pkg.maxCourses })}</p>}
              {!pkg && selectedGroups.length === 0 && <p className="text-xs text-charcoal/55">{t('builder.selectOne')}</p>}
            </div>
            <Button className="mt-5 w-full" size="lg" disabled={!complete} onClick={() => nav('/preview')}>{t('builder.continue')} <Icon name="arrowRight" className="h-4 w-4" /></Button>
          </Card>
          {selectedGroups.length > 0 && (
            <div className="mt-4">
              <Eyebrow className="mb-2">{t('builder.weeklyPreview')}</Eyebrow>
              <Timetable groups={selectedGroups} courses={courses} conflicts={conflicts} compact />
            </div>
          )}
        </aside>
      </div>

      <Modal open={!!picker} onClose={() => { setPicker(null); setQueue([]) }} title={picker ? `${t('courses.chooseGroup')} — ${tr(picker.title)}` : ''}>
        {picker && (
          <ul className="space-y-2">
            {picker.groups.map((g) => {
              const clash = selectedGroups.filter((sg) => sg.courseId !== picker.id).find((sg) => overlaps(g, sg))
              const current = student?.builder.groupIds.includes(g.id)
              const full = isGroupFull(g, students, student?.id)
              return (
                <li key={g.id}>
                  <button type="button" disabled={!!clash || full} onClick={() => tryAdd(g.id)} className={cx('card flex w-full items-center justify-between gap-3 p-4 text-left transition disabled:opacity-50', current ? 'border-forest bg-sage/40' : 'hover:border-forest/40')}>
                    <div>
                      <div className="text-sm font-medium text-charcoal">{g.name}</div>
                      <div className="mt-1"><ScheduleChips group={g} /></div>
                      <div className="mt-1 text-[11px] text-charcoal/50">{t('common.room')} {g.room} · {t('capacity.students', { n: enrolledCount(students, g.id, student?.id), max: g.capacity })}</div>
                      {clash && <div className="mt-1 text-[11px] text-red-700">{t('builder.conflict')}: {tr(courses.find((c) => c.id === clash.courseId)?.title)}</div>}
                      {full && <div className="mt-1 text-[11px] text-amber-800">{t('capacity.full')} — {t('capacity.fullHint')}</div>}
                    </div>
                    {current ? <Icon name="check" className="h-5 w-5 text-forest" /> : <Icon name="plus" className="h-5 w-5 text-charcoal/40" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
    </div>
  )
}
