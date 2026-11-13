'use client'
import { useCallback, useEffect, useState } from 'react'
import { ExtraLessonForm, SessionPanel, SessionStatus } from '../../components/attendance/SessionPanel'
import { Badge, Button, EmptyState, Field, Icon, Input, Modal, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api } from '../../lib/api'
import { enrolledStudents } from '../../lib/enrollment'
import { formatTime } from '../../lib/format'
import { Link } from '../../lib/router'
import { useSearchParams } from '../../lib/routerHooks'
import { useStore } from '../../store/useStore'
import { useCenterScope, type CenterCourses, type CenterLesson } from './centerApi'

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Lessons of the center by day with check-in counts; each opens the live attendance panel (QR, roster, corrections, move). */
export function CenterAttendance() {
  const scope = useCenterScope()
  const { t, tr, lang } = useT()
  const s = useStore()
  const [params] = useSearchParams()
  // A notification about a lesson links here with its day; otherwise the page opens on today.
  const [date, setDate] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? (params.get('date') as string) : todayIso()))
  const [lessons, setLessons] = useState<CenterLesson[] | null>(null)
  const [courses, setCourses] = useState<CenterCourses['courses']>([])
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState<CenterLesson | null>(null)
  const [extraGroup, setExtraGroup] = useState<string>('')
  const [adding, setAdding] = useState(false)

  const load = useCallback((d: string) => api<{ date: string; sessions: CenterLesson[] }>(`${scope.base}/attendance?date=${encodeURIComponent(d)}`).then((r) => setLessons(r.sessions)).catch(() => setFailed(true)), [scope.base])
  useEffect(() => { void load(date) }, [date, load])
  // A notification about another day links here while the page is already open.
  useEffect(() => { const d = params.get('date'); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d) }, [params])
  useEffect(() => { api<CenterCourses>(`${scope.base}/courses`).then((r) => setCourses(r.courses)).catch(() => undefined) }, [scope.base])

  const open = async (l: CenterLesson) => {
    setActive(l)
    await s.loadGroupDetail(l.group.id).catch(() => undefined)
  }
  const course = active ? courses.find((c) => c.id === active.courseId) : undefined
  const group = course?.groups.find((g) => g.id === active?.group.id)
  const session = active ? (s.sessions.find((x) => x.id === active.session.id) ?? { ...active.session, token: '' }) : null
  const groups = courses.flatMap((c) => c.groups.map((g) => ({ ...g, label: `${tr(c.title)} · ${g.name}` })))

  return (
    <div>
      <PageTitle eyebrow={t('dash.center')} title={t('center.attendance')} action={<Link to={scope.links('settings')} className="text-xs font-medium text-forest underline">{t('center.qrTitle')}</Link>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t('session.date')}><Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} /></Field>
        <Field label={t('session.extra')}>
          <div className="flex gap-2">
            <Select value={extraGroup} onChange={(e) => setExtraGroup(e.target.value)}><option value="">—</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</Select>
            <Button variant="secondary" disabled={!extraGroup} onClick={() => setAdding(true)}><Icon name="plus" className="h-3.5 w-3.5" />{t('session.extraAdd')}</Button>
          </div>
        </Field>
      </div>
      {failed && <Notice tone="warn">{t('center.loadError')}</Notice>}
      {lessons && lessons.length === 0 && <EmptyState title={t('center.noLessonsToday')} />}
      {lessons && lessons.length > 0 && (
        <ul className="space-y-2">
          {lessons.map((l) => (
            <li key={l.session.id}>
              <button type="button" onClick={() => void open(l)} className="card flex w-full items-center gap-4 p-3 text-left transition hover:shadow-lift">
                <div className="w-16 shrink-0 text-center"><div className="font-display text-xl text-charcoal">{formatTime(l.session.startsAt ?? `${l.session.date}T${l.session.start}:00`, lang)}</div><div className="text-[10px] text-charcoal/45">{l.session.start}–{l.session.end}</div></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-charcoal">{tr(l.courseTitle)} · {l.group.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-charcoal/55"><SessionStatus session={{ ...l.session, token: '' }} /><span>{l.teacherName} · {t('common.room')} {l.group.room}</span></div>
                  <div className="mt-1 text-xs text-charcoal/55">{t('center.lessonCounts', { present: l.present, absent: l.absent, roster: l.roster })}</div>
                </div>
                <Badge tone="sage">{t('center.openSession')}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!active} onClose={() => { setActive(null); void load(date) }} title={active ? `${tr(active.courseTitle)} · ${active.group.name}` : ''} wide>
        {active && session && course && group
          ? <SessionPanel session={session} course={course} group={group} roster={enrolledStudents(s.students, group.id)} />
          : <div className="py-10 text-center text-sm text-charcoal/55">{t('common.loading')}</div>}
      </Modal>
      <Modal open={adding} onClose={() => setAdding(false)} title={t('session.extraAdd')}>
        {adding && extraGroup && <ExtraLessonForm groupId={extraGroup} onDone={() => { setAdding(false); void load(date) }} />}
      </Modal>
    </div>
  )
}
