import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ScheduleChips } from '../../components/course/CourseCard'
import { Timetable } from '../../components/Timetable'
import { ArtCover, Badge, Button, Card, cx, Eyebrow, Icon, Input, Modal, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isPublicListed } from '../../lib/access'
import { formatSom } from '../../lib/format'
import { findConflicts, overlaps, resolveGroups, weeklyHours } from '../../lib/schedule'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Course } from '../../types'

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
  const setBuilderPackage = useStore((s) => s.setBuilderPackage)
  const addBuilderGroup = useStore((s) => s.addBuilderGroup)
  const removeBuilderCourse = useStore((s) => s.removeBuilderCourse)
  const notify = useStore((s) => s.notify)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [picker, setPicker] = useState<Course | null>(null)

  useEffect(() => {
    const p = params.get('package')
    if (p && student && packages.some((x) => x.id === p && x.enabled) && student.builder.packageId !== p) setBuilderPackage(student.id, p)
  }, [params, student, packages, setBuilderPackage])

  const pkg = packages.find((p) => p.id === student?.builder.packageId)
  const selectedGroups = useMemo(() => resolveGroups(student?.builder.groupIds ?? [], courses), [student, courses])
  const conflicts = findConflicts(selectedGroups)
  const total = selectedGroups.reduce((n, g) => n + (courses.find((c) => c.id === g.courseId)?.price ?? 0), 0)
  const publicCourses = courses.filter(isPublicListed)
  const list = publicCourses.filter((c) => (!cat || c.categoryId === cat) && (!q || (tr(c.title) + (teachers.find((x) => x.id === c.teacherId)?.name ?? '')).toLowerCase().includes(q.toLowerCase())))
  const selectedCourseIds = new Set(selectedGroups.map((g) => g.courseId))
  const complete = !!pkg && selectedGroups.length === pkg.maxCourses && conflicts.length === 0

  const tryAdd = (groupId: string) => {
    if (!student) return
    const r = addBuilderGroup(student.id, groupId)
    if (r.ok) { notify(t('courses.inPlan')); setPicker(null); return }
    const conflictName = r.conflictWith ? tr(courses.find((c) => c.id === r.conflictWith)?.title) : ''
    const msg = { 'no-package': t('builder.pickPackageFirst'), limit: t('builder.limitReached'), duplicate: t('builder.duplicate'), conflict: `${t('builder.conflict')} — ${conflictName}. ${t('builder.conflictHint')}`, disabled: t('builder.packageDisabled') }[r.reason]
    notify(msg, 'warn')
  }
  const onAddCourse = (c: Course) => {
    if (!pkg) { notify(t('builder.pickPackageFirst'), 'warn'); return }
    if (selectedCourseIds.has(c.id)) { notify(t('builder.duplicate'), 'warn'); return }
    if (c.groups.length === 1) tryAdd(c.groups[0].id)
    else setPicker(c)
  }

  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle eyebrow={t('common.demo')} title={t('builder.title')} subtitle={t('builder.subtitle')} />

      {/* Step 1 — package */}
      <section className="mb-10">
        <Eyebrow className="mb-4">{t('builder.step1')}</Eyebrow>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p) => {
            const active = pkg?.id === p.id
            return (
              <button key={p.id} type="button" disabled={!p.enabled} aria-pressed={active} onClick={() => { if (student) { if (pkg && p.maxCourses < selectedGroups.length) notify(t('builder.switchPackageWarn'), 'warn'); setBuilderPackage(student.id, p.id) } }} className={cx('card flex items-start justify-between gap-3 p-5 text-left transition disabled:opacity-40', active ? 'ring-inset-forest border-forest bg-sage/40' : 'hover:border-forest/40')}>
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
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
        {/* Step 2 — courses */}
        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Eyebrow>{t('builder.step2')}</Eyebrow>
            <div className="flex gap-2">
              <div className="relative"><Icon name="search" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-charcoal/40" /><Input aria-label={t('common.search')} className="w-48 pl-9 py-2" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <Select aria-label={t('common.category')} className="w-44 py-2" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">{t('common.all')}</option>{categories.map((c) => <option key={c.id} value={c.id}>{tr(c.name)}</option>)}</Select>
            </div>
          </div>
          {!pkg && <Notice tone="warn" className="mb-4">{t('builder.pickPackageFirst')}</Notice>}
          <ul className="space-y-2">
            {list.map((c) => {
              const selected = selectedCourseIds.has(c.id)
              const g = selectedGroups.find((x) => x.courseId === c.id)
              const clashes = !selected && c.groups.every((cg) => selectedGroups.some((sg) => overlaps(cg, sg)))
              const limit = !!pkg && !selected && selectedGroups.length >= pkg.maxCourses
              const center = centers.find((x) => x.id === c.centerId)
              return (
                <li key={c.id} className={cx('card flex items-center gap-4 p-3 transition', selected && 'border-forest/50 bg-sage/30')}>
                  <ArtCover seed={c.coverSeed} tone={center?.tone} imageUrl={c.imageUpload?.previewUrl || c.imageUrl} className="hidden h-16 w-24 shrink-0 rounded-control sm:block" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/courses/${c.id}`} className="truncate font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link>
                      <Badge tone="muted">{tr(categories.find((x) => x.id === c.categoryId)?.name)}</Badge>
                      {clashes && <Badge tone="danger"><Icon name="warn" className="h-3 w-3" />{t('builder.conflict')}</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal/55">
                      <span>{center?.name}</span>
                      {g ? <ScheduleChips group={g} compact /> : <ScheduleChips group={c.groups[0]} compact />}
                      {c.groups.length > 1 && !g && <span className="text-charcoal/40">+{c.groups.length - 1} {t('common.groups').toLowerCase()}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium text-charcoal">{formatSom(c.price, lang, false)}</div>
                    <div className="text-[10px] text-charcoal/45">{t('common.som')} {t('common.perMonth')}</div>
                  </div>
                  {selected ? (
                    <div className="flex shrink-0 gap-1">
                      {c.groups.length > 1 && <Button size="sm" variant="ghost" onClick={() => setPicker(c)} aria-label={t('builder.changeGroup')}><Icon name="refresh" className="h-3.5 w-3.5" /></Button>}
                      <Button size="sm" variant="secondary" onClick={() => student && removeBuilderCourse(student.id, c.id)}><Icon name="x" className="h-3.5 w-3.5" />{t('common.remove')}</Button>
                    </div>
                  ) : (
                    <Button size="sm" disabled={!pkg || limit} title={limit ? t('builder.limitReached') : undefined} onClick={() => onAddCourse(c)}><Icon name="plus" className="h-3.5 w-3.5" />{t('common.add')}</Button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {/* Summary */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <Eyebrow>{t('builder.yourSelection')}</Eyebrow>
              {pkg && <Badge tone="sage">{tr(pkg.name)} · {selectedGroups.length}/{pkg.maxCourses}</Badge>}
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
                      <div className="text-right text-sm text-charcoal">{formatSom(c.price, lang, false)}</div>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="mt-4 border-t border-charcoal/10 pt-4">
              <div className="flex items-end justify-between">
                <span className="text-sm text-charcoal/60">{t('builder.monthlyTotal')}</span>
                <span className="font-display text-3xl text-charcoal">{formatSom(total, lang)}</span>
              </div>
              <p className="mt-2 text-[11px] text-charcoal/45">{t('builder.transparent')}</p>
              {selectedGroups.length > 0 && <p className="mt-1 text-[11px] text-charcoal/45">{weeklyHours(selectedGroups)} {t('preview.hoursPerWeek')}</p>}
            </div>
            <div className="mt-4 space-y-2">
              {conflicts.length > 0 && <Notice tone="warn"><Icon name="warn" className="mr-1 inline h-3.5 w-3.5" />{t('builder.conflictHint')}</Notice>}
              {conflicts.length === 0 && selectedGroups.length > 1 && <Notice tone="info"><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />{t('builder.noConflicts')}</Notice>}
              {pkg && selectedGroups.length !== pkg.maxCourses && <p className="text-xs text-charcoal/55">{t('builder.needExactly', { n: pkg.maxCourses })}</p>}
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

      <Modal open={!!picker} onClose={() => setPicker(null)} title={picker ? `${t('courses.chooseGroup')} — ${tr(picker.title)}` : ''}>
        {picker && (
          <ul className="space-y-2">
            {picker.groups.map((g) => {
              const clash = selectedGroups.filter((sg) => sg.courseId !== picker.id).find((sg) => overlaps(g, sg))
              const current = student?.builder.groupIds.includes(g.id)
              const full = g.enrolled >= g.seats
              return (
                <li key={g.id}>
                  <button type="button" disabled={!!clash || full} onClick={() => tryAdd(g.id)} className={cx('card flex w-full items-center justify-between gap-3 p-4 text-left transition disabled:opacity-50', current ? 'border-forest bg-sage/40' : 'hover:border-forest/40')}>
                    <div>
                      <div className="text-sm font-medium text-charcoal">{g.name}</div>
                      <div className="mt-1"><ScheduleChips group={g} /></div>
                      <div className="mt-1 text-[11px] text-charcoal/50">{t('common.room')} {g.room} · {Math.max(0, g.seats - g.enrolled)} {t('common.seatsLeft')}</div>
                      {clash && <div className="mt-1 text-[11px] text-red-700">{t('builder.conflict')}: {tr(courses.find((c) => c.id === clash.courseId)?.title)}</div>}
                      {full && <div className="mt-1 text-[11px] text-amber-800">{t('courses.full')}</div>}
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
