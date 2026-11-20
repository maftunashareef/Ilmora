import { useState } from 'react'
import { CERTIFICATE_KINDS, checkCoursePrice, courseFormat, discountFromDraft, discountToDraft, emptyDiscountDraft, isOnlineCourse, isSafeExternalUrl, ONLINE_PROVIDER_SLUG, type LearningFormat } from '@ilmora/shared'
import { useT } from '../../i18n/useT'
import { emptyL } from '../../i18n/useT'
import { uid, useStore } from '../../store/useStore'
import { enrolledCount, groupsCapacityError, validateCapacity } from '../../lib/enrollment'
import type { Course, Group, L, Level, Teacher } from '../../types'
import { PublishFields, type PublishDraft, type PublishMode } from '../PublishFields'
import { finalizePublish } from '../publish'
import { DiscountFields, type Pricing } from './DiscountFields'
import { Badge, Button, Field, Icon, Input, LField, Notice, Segmented, Select, Textarea } from '../ui'
import { cx } from '../ui/helpers'
import { StorageUploadField } from '../StorageUploadField'

const DAYS = [0, 1, 2, 3, 4, 5, 6]

export function GroupsEditor({ groups, onChange, courseId, locked }: { groups: Group[]; onChange: (g: Group[]) => void; courseId: string; locked?: boolean }) {
  const { t } = useT()
  const students = useStore((s) => s.students)
  const update = (id: string, patch: Partial<Group>) => onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const enrolled = enrolledCount(students, g.id)
        const check = validateCapacity(g.capacity, enrolled)
        return (
        <div key={g.id} className={cx('rounded-card border border-charcoal/10 bg-ivory/50 p-4', locked && 'opacity-70', !check.ok && 'border-red-300')}>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_repeat(2,minmax(0,1fr))]">
            <Field label={t('common.name')}><Input disabled={locked} value={g.name} onChange={(e) => update(g.id, { name: e.target.value })} /></Field>
            <Field label={t('admin.groups.start')}><Input disabled={locked} type="time" value={g.start} onChange={(e) => update(g.id, { start: e.target.value })} /></Field>
            <Field label={t('admin.groups.end')}><Input disabled={locked} type="time" value={g.end} onChange={(e) => update(g.id, { end: e.target.value })} /></Field>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
            <div>
              <div className="mb-1.5 text-xs font-medium text-charcoal/70">{t('admin.groups.days')}</div>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d) => (
                  <button key={d} type="button" disabled={locked} aria-pressed={g.days.includes(d)} onClick={() => update(g.id, { days: g.days.includes(d) ? g.days.filter((x) => x !== d) : [...g.days, d].sort() })} className={cx('rounded-sm px-2 py-1 text-xs font-medium transition', g.days.includes(d) ? 'bg-forest text-ivory' : 'bg-paper text-charcoal/60 border border-charcoal/10')}>
                    {t(`dayShort.${d}` as 'dayShort.0')}
                  </button>
                ))}
              </div>
            </div>
            <Field label={t('common.room')}><Input disabled={locked} value={g.room} onChange={(e) => update(g.id, { room: e.target.value })} /></Field>
            <Field label={t('capacity.field')} hint={t('capacity.students', { n: enrolled, max: g.capacity })}><Input disabled={locked} type="number" min={1} step={1} value={g.capacity} onChange={(e) => update(g.id, { capacity: Number(e.target.value) })} /></Field>
            <div className="flex items-end pb-2.5 text-xs">{check.ok ? <span className="text-charcoal/50">{t('capacity.left', { n: g.capacity - enrolled })}</span> : <span className="text-red-700">{check.reason === 'not-integer' ? t('capacity.invalid') : t('capacity.belowEnrolled', { n: enrolled })}</span>}</div>
          </div>
          {!locked && <div className="mt-3 flex justify-end"><Button size="sm" variant="danger" disabled={enrolled > 0} title={enrolled > 0 ? t('capacity.belowEnrolled', { n: enrolled }) : undefined} onClick={() => onChange(groups.filter((x) => x.id !== g.id))}><Icon name="trash" className="h-3.5 w-3.5" />{t('common.delete')}</Button></div>}
        </div>
        )
      })}
      {!locked && <Button size="sm" variant="secondary" onClick={() => onChange([...groups, { id: uid('g'), courseId, name: `Group ${String.fromCharCode(65 + groups.length)}`, days: [0, 2], start: '18:00', end: '19:30', room: '', capacity: 12 }])}><Icon name="plus" className="h-3.5 w-3.5" />{t('admin.groups.add')}</Button>}
    </div>
  )
}

const curriculumToText = (items: L[], lang: 'uz' | 'ru' | 'en') => items.map((i) => i[lang]).join('\n')

/**
 * Course editor. `mode` decides what may change: the Super Admin everything, a teacher what the teacher switches allow,
 * a center (`mode: 'center'`) its own course with its own teachers (`teachers`, `center`), prices and discounts included.
 */
export function CourseForm({ initial, teacherId, mode, teachers: teachersProp, center, pricing, onSave, onCancel }: { initial?: Course; teacherId?: string; mode: PublishMode; teachers?: Teacher[]; center?: { id: string; name: string }; pricing?: Pricing; onSave: (c: Course) => void; onCancel: () => void }) {
  const { t, tr } = useT()
  const centers = useStore((s) => s.centers)
  const categories = useStore((s) => s.categories)
  const catalogTeachers = useStore((s) => s.teachers)
  const subjects = useStore((s) => s.subjects)
  const perms = useStore((s) => s.site.permissions.teacher)
  const students = useStore((s) => s.students)
  const notify = useStore((s) => s.notify)
  const teachers = teachersProp ?? catalogTeachers
  // The platform center/profile of online courses is not a real center or teacher: it is never offered for an offline course.
  const offlineCenters = center && !centers.some((c) => c.id === center.id) ? [{ id: center.id, name: center.name }, ...centers] : centers.filter((c) => c.slug !== ONLINE_PROVIDER_SLUG)
  const offlineTeachers = teachers.filter((x) => x.slug !== ONLINE_PROVIDER_SLUG)
  const ownerId = initial?.teacherId ?? teacherId ?? offlineTeachers[0]?.id
  const owner = teachers.find((x) => x.id === ownerId)

  const [draft, setDraft] = useState<Course>(() => initial ?? {
    id: uid('c'), title: emptyL(), summary: emptyL(), description: emptyL(), curriculum: [], categoryId: categories[0]?.id ?? '', centerId: center?.id ?? owner?.centerId ?? (mode === 'teacher' ? '' : offlineCenters[0]?.id ?? ''), teacherId: ownerId ?? '',
    level: 'beginner', durationMonths: 3, price: 500000, coverSeed: Math.floor(Math.random() * 60), groups: [],
    status: 'draft', visibility: 'public', audience: { studentIds: [], groupIds: [] }, featured: false, updatedAt: new Date().toISOString(),
  })
  // Discount fields (Super Admin only); all empty = no discount.
  const [disc, setDisc] = useState(() => discountToDraft(initial?.discount))
  const [pub, setPub] = useState<PublishDraft>({ status: initial?.status ?? 'draft', visibility: initial ? initial.visibility : null, audience: initial?.audience ?? { studentIds: [], groupIds: [] } })
  const [curr, setCurr] = useState<Record<'uz' | 'ru' | 'en', string>>({ uz: curriculumToText(draft.curriculum, 'uz'), ru: curriculumToText(draft.curriculum, 'ru'), en: curriculumToText(draft.curriculum, 'en') })

  const isTeacher = mode === 'teacher'
  const isCenter = mode === 'center'
  const lockText = isTeacher && !perms.editCourses
  const lockPrice = isTeacher && !perms.editPrices
  const lockSchedule = isTeacher && !(perms.editSchedules && perms.manageGroups)
  const set = <K extends keyof Course>(k: K, v: Course[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const online = isOnlineCourse(draft)
  // A new course follows the calculator (ТЗ 18.11, 9.2); a course from before keeps its old rules (Шерзод, 20.11).
  const priceRule = initial ? (initial.priceRule ?? 0) : 1

  // Offline <-> online (Super Admin only). An online course is free and has no groups, so a course that already has groups cannot become one.
  const switchFormat = (f: LearningFormat) => {
    if (f === courseFormat(draft)) return
    if (f === 'ONLINE') {
      if (draft.groups.length > 0) { notify(t('admin.course.formatLocked'), 'warn'); return }
      setDraft((d) => ({ ...d, learningFormat: 'ONLINE', price: 0, discount: null, meyosGrant: false, certificate: d.certificate ?? 'NONE' }))
      setDisc(emptyDiscountDraft())
    } else {
      setDraft((d) => ({ ...d, learningFormat: 'OFFLINE', centerId: offlineCenters[0]?.id ?? '', teacherId: offlineTeachers[0]?.id ?? '', price: d.price || 500000, externalUrl: null, providerName: null, instructorName: null, certificate: 'NONE', durationText: null }))
    }
  }

  const save = () => {
    if (!draft.title.uz && !draft.title.en && !draft.title.ru) { notify(`${t('common.title')}: ${t('common.required')}`, 'warn'); return }
    if (online && (!isSafeExternalUrl(draft.externalUrl) || !draft.providerName?.trim())) { notify(t('admin.course.linkInvalid'), 'warn'); return }
    const bad = groupsCapacityError(draft.groups, students)
    if (bad) { notify(bad.check.reason === 'not-integer' ? t('capacity.invalid') : t('capacity.belowEnrolled', { n: bad.check.enrolled }), 'warn'); return }
    const r = finalizePublish(pub, mode, perms)
    if (!r.ok) { notify(t(r.error), 'warn'); return }
    if (!online && !lockPrice && priceRule === 1 && !checkCoursePrice(draft.price).ok) { notify(t('calc.err.price'), 'warn'); return }
    let discount: Course['discount'] = draft.discount ?? null
    if (mode === 'admin' || isCenter) {
      const parsed = discountFromDraft(disc, new Date(), pricing?.maxDiscountPercent, priceRule)
      if (!parsed.ok) { notify(t('discount.invalid'), 'warn'); return }
      discount = parsed.discount
    }
    const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
    const uz = lines(curr.uz), ru = lines(curr.ru), en = lines(curr.en)
    const n = Math.max(uz.length, ru.length, en.length)
    const curriculum: L[] = Array.from({ length: n }, (_, i) => ({ uz: uz[i] ?? en[i] ?? ru[i] ?? '', ru: ru[i] ?? en[i] ?? uz[i] ?? '', en: en[i] ?? uz[i] ?? ru[i] ?? '' }))
    onSave({ ...draft, ...(mode === 'admin' || isCenter ? { discount } : {}), ...(online ? { price: 0, groups: [], discount: null } : {}), curriculum, ...r.patch })
    if (r.note) notify(t(r.note), 'warn')
  }

  return (
    <div className="space-y-6">
      {lockText && <Notice tone="warn"><Icon name="lock" className="mr-1 inline h-3.5 w-3.5" />{t('studio.lockedByAdmin')}: {t('perm.teacher.editCourses')}</Notice>}
      {isTeacher && !online && !draft.centerId && <Notice tone="warn">{t('apiError.teacherCenterRequired')}</Notice>}
      {mode === 'admin' && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-charcoal/70">{t('format.label')}</div>
          <Segmented<LearningFormat> value={courseFormat(draft)} onChange={switchFormat} options={[{ id: 'OFFLINE', label: t('format.badge.OFFLINE') }, { id: 'ONLINE', label: t('format.badge.ONLINE') }]} />
        </div>
      )}
      {online && <Notice tone="info" className="text-xs">{t('admin.course.onlineHint')}</Notice>}
      <LField label={t('common.title')} required value={draft.title} onChange={(v) => set('title', v)} />
      <fieldset disabled={lockText} className="space-y-5 disabled:opacity-70">
        <LField label={t('common.summary')} value={draft.summary} onChange={(v) => set('summary', v)} />
        <LField label={t('common.description')} multiline value={draft.description} onChange={(v) => set('description', v)} />
        <div>
          <div className="mb-1.5 flex justify-between text-xs font-medium text-charcoal/70"><span>{t('common.curriculum')}</span><span className="font-normal text-charcoal/45">{t('admin.courses.curriculumHint')}</span></div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['uz', 'ru', 'en'] as const).map((lg) => (
              <div key={lg} className="relative"><span className="pointer-events-none absolute left-3 top-2.5 text-[10px] font-semibold tracking-wider text-champagne">{lg.toUpperCase()}</span><Textarea rows={6} className="pl-10" value={curr[lg]} onChange={(e) => setCurr({ ...curr, [lg]: e.target.value })} /></div>
            ))}
          </div>
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('common.category')}><Select value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{tr(c.name)}</option>)}</Select></Field>
        {!online && <Field label={t('common.center')}><Select disabled={isTeacher || isCenter} value={draft.centerId} onChange={(e) => set('centerId', e.target.value)}>{offlineCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        {!online && <Field label={t('common.teacher')}><Select disabled={isTeacher} value={draft.teacherId} onChange={(e) => set('teacherId', e.target.value)}>{offlineTeachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>}
        {!online && <Field label={t('studio.subjects')}><Select value={draft.subjectId ?? ''} onChange={(e) => set('subjectId', e.target.value || undefined)}><option value="">{t('studio.noSubject')}</option>{subjects.filter((s) => s.teacherId === draft.teacherId).map((s) => <option key={s.id} value={s.id}>{tr(s.name)}</option>)}</Select></Field>}
        <Field label={t('common.level')}><Select value={draft.level} onChange={(e) => set('level', e.target.value as Level)}>{(['beginner', 'intermediate', 'advanced'] as Level[]).map((l) => <option key={l} value={l}>{t(`level.${l}`)}</option>)}</Select></Field>
        {!online && <Field label={`${t('common.duration')} (${t('common.months')})`}><Input type="number" min={1} value={draft.durationMonths} onChange={(e) => set('durationMonths', Number(e.target.value))} /></Field>}
        {!online && <Field label={`${t('common.price')} (${t('common.som')} ${t('common.perMonth')})`} hint={lockPrice ? <Badge tone="warn"><Icon name="lock" className="h-3 w-3" />{t('studio.lockedByAdmin')}</Badge> : undefined}><Input disabled={lockPrice} type="number" min={0} step={1000} value={draft.price} onChange={(e) => set('price', Number(e.target.value))} /></Field>}
        {mode === 'admin' && !online && <Field label={t('admin.course.meyos')}><Select value={draft.meyosGrant ? '1' : '0'} onChange={(e) => set('meyosGrant', e.target.value === '1')}><option value="0">{t('common.no')}</option><option value="1">{t('common.yes')}</option></Select></Field>}
        {mode === 'admin' && <Field label={t('common.featured')}><Select value={draft.featured ? '1' : '0'} onChange={(e) => set('featured', e.target.value === '1')}><option value="0">{t('common.no')}</option><option value="1">{t('common.yes')}</option></Select></Field>}
      </div>
      {online && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('admin.course.externalUrl')} required><Input type="url" inputMode="url" placeholder="https://…" value={draft.externalUrl ?? ''} onChange={(e) => set('externalUrl', e.target.value.trim() || null)} /></Field>
          <Field label={t('admin.course.provider')} required><Input maxLength={120} value={draft.providerName ?? ''} onChange={(e) => set('providerName', e.target.value || null)} /></Field>
          <Field label={t('online.instructor')}><Input maxLength={160} value={draft.instructorName ?? ''} onChange={(e) => set('instructorName', e.target.value || null)} /></Field>
          <Field label={t('online.certificate')}><Select value={draft.certificate ?? 'NONE'} onChange={(e) => set('certificate', e.target.value as NonNullable<Course['certificate']>)}>{CERTIFICATE_KINDS.map((k) => <option key={k} value={k}>{t(`online.cert.${k}` as 'online.cert.NONE')}</option>)}</Select></Field>
          <div className="md:col-span-2"><LField label={t('admin.course.durationText')} value={draft.durationText ?? emptyL()} onChange={(v) => set('durationText', v)} /></div>
        </div>
      )}
      {(mode === 'admin' || isCenter) && !online && <DiscountFields value={disc} onChange={setDisc} price={draft.price} pricing={pricing} priceRule={priceRule} />}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('common.imageUrl')} hint={t('common.optional')}><Input placeholder="https://…" value={draft.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value || undefined)} /></Field>
        {/* The uploaded cover lands in object storage and its address becomes the image URL (no browser-only preview is ever saved). */}
        <div><div className="mb-1.5 text-xs font-medium text-charcoal/70">{t('common.image')} · {t('common.upload')}</div><StorageUploadField kind="course-image" url={draft.imageUrl} onUploaded={(r) => setDraft((d) => ({ ...d, imageUrl: r.publicUrl, imageUpload: undefined }))} onRemove={() => setDraft((d) => ({ ...d, imageUrl: undefined, imageUpload: undefined }))} /></div>
      </div>
      {!online && (
        <div>
          <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium text-charcoal">{t('courses.groupsAndSchedule')}</span>{lockSchedule && <Badge tone="warn"><Icon name="lock" className="h-3 w-3" />{t('studio.lockedByAdmin')}</Badge>}</div>
          <GroupsEditor groups={draft.groups} onChange={(g) => set('groups', g)} courseId={draft.id} locked={lockSchedule} />
        </div>
      )}
      <PublishFields value={pub} onChange={setPub} teacherId={draft.teacherId} mode={mode} />
      <div className="flex justify-end gap-2 border-t border-charcoal/10 pt-4">
        <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button onClick={save}>{t('common.save')}</Button>
      </div>
    </div>
  )
}
