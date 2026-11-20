'use client'
import { useCallback, useEffect, useState } from 'react'
import { HOMEWORK_GRADES, HOMEWORK_SUBMIT_MODES, isSafeExternalUrl, type HomeworkSubmitMode } from '@ilmora/shared'
import { fromTashkentInput, linesToLinks, tashkentDateTime, toTashkentInput } from '../../components/homework/homeworkFormat'
import { Badge, Button, EmptyState, Field, Icon, Input, Modal, Notice, PageTitle, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { Link } from '../../lib/router'
import { useParams } from '../../lib/routerHooks'
import { teacherHomeworkApi, type Homework, type HomeworkDraft, type TeacherHomeworkDetail, type TeacherHomeworkList } from '../../services/centerStudents'
import { useStore } from '../../store/useStore'

const stateTone = { missing: 'muted', submitted: 'sage', late: 'warn' } as const
const plusDays = (n: number) => toTashkentInput(new Date(Date.now() + n * 86_400_000).toISOString()).slice(0, 10) + 'T18:00'

/** Homework of one group (ТЗ 2026-11-18, 8): the teacher gives it, sees who handed in, grades, extends a deadline. */
export function StudioHomework() {
  const { groupId = '' } = useParams<{ groupId: string }>()
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [list, setList] = useState<TeacherHomeworkList | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [editing, setEditing] = useState<(HomeworkDraft & { id?: string }) | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const load = useCallback(() => teacherHomeworkApi.list(groupId).then(setList, (e) => setFailed(apiErrorText(e, lang))), [groupId, lang])
  useEffect(() => { void load() }, [load])
  const fail = (e: unknown) => notify(apiErrorText(e, lang), 'warn')

  const remove = async (h: Homework) => {
    if (!confirm(t('hw.deleteConfirm'))) return
    try { await teacherHomeworkApi.remove(h.id); notify(t('common.saved')); await load() } catch (e) { notify(isApiError(e) && e.code === 'homework_has_submissions' ? t('hw.err.hasSubmissions') : apiErrorText(e, lang), 'warn') }
  }

  return (
    <div>
      <Link to={`/teacher/groups/${groupId}`} className="mb-3 inline-flex items-center gap-1 text-xs text-charcoal/55 hover:text-forest"><Icon name="arrowLeft" className="h-3.5 w-3.5" />{t('group.details')}</Link>
      <PageTitle eyebrow={list ? `${tr(list.group.courseTitle)} · ${list.group.name}` : t('dash.teacherStudio')} title={t('hw.title')}
        action={<Button onClick={() => setEditing({ title: '', description: '', dueAt: plusDays(7), links: [], submitModes: ['TEXT', 'LINK'] })}><Icon name="plus" className="h-4 w-4" />{t('hw.new')}</Button>} />
      {failed && <Notice tone="warn">{failed}</Notice>}
      {list && list.items.length === 0 && <EmptyState title={t('hw.empty')} />}
      <ul className="space-y-3">
        {list?.items.map((h) => (
          <li key={h.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenId(h.id)}>
                <div className="font-medium text-charcoal">{h.title}</div>
                <div className="mt-0.5 text-xs text-charcoal/55">{t('hw.dueAt', { date: tashkentDateTime(h.dueAt, lang) })} · {t('hw.count', { done: h.submitted, total: list.students })}</div>
              </button>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setOpenId(h.id)}>{t('common.open')}</Button>
                <Button size="sm" variant="ghost" aria-label={t('hw.edit')} onClick={() => setEditing({ id: h.id, title: h.title, description: h.description, dueAt: toTashkentInput(h.dueAt), links: h.links, submitModes: h.submitModes })}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => void remove(h)}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {editing && <HomeworkForm draft={editing} onClose={() => setEditing(null)} onSave={async (d) => {
        const body = { ...d, dueAt: fromTashkentInput(d.dueAt) }
        try {
          if (editing.id) await teacherHomeworkApi.update(editing.id, body)
          else await teacherHomeworkApi.create(groupId, body)
          setEditing(null); notify(t('common.saved')); await load()
        } catch (e) { fail(e) }
      }} />}
      {openId && <HomeworkReview id={openId} onClose={() => { setOpenId(null); void load() }} />}
    </div>
  )
}

function HomeworkForm({ draft, onClose, onSave }: { draft: HomeworkDraft & { id?: string }; onClose: () => void; onSave: (d: HomeworkDraft) => Promise<void> }) {
  const { t } = useT()
  const [d, setD] = useState(draft)
  const [links, setLinks] = useState(draft.links.join('\n'))
  const [busy, setBusy] = useState(false)
  const parsed = linesToLinks(links)
  const badLinks = parsed.filter((l) => !isSafeExternalUrl(l))
  const ok = d.title.trim() && d.description.trim() && d.dueAt && d.submitModes.length > 0 && badLinks.length === 0
  const toggle = (m: HomeworkSubmitMode) => setD((x) => ({ ...x, submitModes: x.submitModes.includes(m) ? x.submitModes.filter((y) => y !== m) : [...x.submitModes, m] }))
  return (
    <Modal open onClose={onClose} title={draft.id ? t('hw.edit') : t('hw.new')} wide footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={!ok || busy} onClick={async () => { setBusy(true); try { await onSave({ ...d, links: parsed }) } finally { setBusy(false) } }}>{t('common.save')}</Button></>}>
      <div className="grid gap-4">
        <Field label={t('hw.name')} required><Input value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} /></Field>
        <Field label={t('hw.description')} hint={t('hw.descriptionHint')} required><Textarea rows={6} maxLength={5000} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
        <Field label={t('hw.due')} required><Input type="datetime-local" value={d.dueAt} onChange={(e) => setD({ ...d, dueAt: e.target.value })} /></Field>
        <Field label={t('hw.materials')} hint={t('hw.materialsHint')}><Textarea rows={3} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" />{badLinks.length > 0 && <p className="mt-1 text-xs text-red-700">{t('hw.badLink')}: {badLinks.join(', ')}</p>}</Field>
        <Field label={t('hw.modes')}>
          <div className="flex flex-wrap gap-4">
            {HOMEWORK_SUBMIT_MODES.map((m) => <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-forest" checked={d.submitModes.includes(m)} onChange={() => toggle(m)} />{t(`hw.mode.${m}`)}</label>)}
            <label className="flex cursor-not-allowed items-center gap-2 text-sm text-charcoal/40" title={t('hw.materialsHint')}><input type="checkbox" disabled className="h-4 w-4" />ZIP</label>
          </div>
        </Field>
      </div>
    </Modal>
  )
}

/** Who handed in, late or not; the last hand-in and the history; a grade with a comment; a later deadline for one student. */
function HomeworkReview({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [data, setData] = useState<TeacherHomeworkDetail | null>(null)
  const [grade, setGrade] = useState<Record<string, { grade: number; comment: string }>>({})
  const [extend, setExtend] = useState<Record<string, string>>({})
  const load = useCallback(() => teacherHomeworkApi.detail(id).then(setData, (e) => notify(apiErrorText(e, lang), 'warn')), [id, lang, notify])
  useEffect(() => { void load() }, [load])
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); notify(t('common.saved')); await load() } catch (e) { notify(apiErrorText(e, lang), 'warn') } }

  return (
    <Modal open onClose={onClose} wide title={data?.homework.title ?? t('hw.title')}>
      {!data ? <p className="text-sm text-charcoal/55">{t('common.loading')}</p> : (
        <div>
          <p className="whitespace-pre-wrap text-sm text-charcoal/80">{data.homework.description}</p>
          {data.homework.links.length > 0 && <ul className="mt-2 space-y-1 text-sm">{data.homework.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noopener noreferrer" className="break-all text-forest underline">{l}</a></li>)}</ul>}
          <p className="mt-2 text-xs text-charcoal/55">{t('hw.dueAt', { date: tashkentDateTime(data.homework.dueAt, lang) })}</p>
          {data.students.length === 0 && <EmptyState title={t('journal.noStudents')} />}
          <ul className="mt-5 space-y-3">
            {data.students.map((st) => {
              const g = grade[st.id] ?? { grade: st.last?.grade ?? 5, comment: st.last?.comment ?? '' }
              return (
                <li key={st.id} className="rounded-card border border-charcoal/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-charcoal">{st.name}</div>
                    <div className="flex items-center gap-2"><Badge tone={stateTone[st.state]}>{t(`hw.state.${st.state}`)}</Badge>{st.last?.grade && <Badge tone="forest">{t('hw.graded', { grade: st.last.grade })}</Badge>}</div>
                  </div>
                  {st.extendedTo && <p className="mt-1 text-xs text-charcoal/55">{t('hw.extendedTo', { date: tashkentDateTime(st.extendedTo, lang) })}</p>}
                  {st.last && (
                    <div className="mt-3 rounded-control bg-ivory/70 p-3 text-sm">
                      <div className="text-xs text-charcoal/50">{t('hw.submittedAt', { date: tashkentDateTime(st.last.submittedAt, lang) })}</div>
                      {st.last.text && <p className="mt-1 whitespace-pre-wrap text-charcoal/85">{st.last.text}</p>}
                      {st.last.link && <a href={st.last.link} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-forest underline">{st.last.link}</a>}
                      {st.history.length > 0 && <details className="mt-2 text-xs text-charcoal/60"><summary>{t('hw.history')} · {st.history.length}</summary><ul className="mt-1 space-y-1">{st.history.map((h) => <li key={h.id}>{tashkentDateTime(h.submittedAt, lang)}{h.link && <> · <a href={h.link} target="_blank" rel="noopener noreferrer" className="break-all underline">{h.link}</a></>}{h.text && <> · {h.text.slice(0, 120)}</>}</li>)}</ul></details>}
                    </div>
                  )}
                  <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr_auto]">
                    <select aria-label={t('hw.grade')} disabled={!st.last} value={g.grade} onChange={(e) => setGrade({ ...grade, [st.id]: { ...g, grade: Number(e.target.value) } })} className="rounded-control border border-charcoal/15 px-3 py-2 text-sm">{HOMEWORK_GRADES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
                    <Input aria-label={t('hw.comment')} placeholder={t('hw.comment')} disabled={!st.last} maxLength={2000} value={g.comment} onChange={(e) => setGrade({ ...grade, [st.id]: { ...g, comment: e.target.value } })} />
                    <Button size="sm" disabled={!st.last} onClick={() => void act(() => teacherHomeworkApi.grade(id, st.id, g.grade, g.comment.trim() || null))}>{t('hw.saveGrade')}</Button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input type="datetime-local" aria-label={t('hw.extend')} value={extend[st.id] ?? ''} onChange={(e) => setExtend({ ...extend, [st.id]: e.target.value })} className="w-56" />
                    <Button size="sm" variant="secondary" disabled={!extend[st.id]} onClick={() => void act(() => teacherHomeworkApi.extend(id, st.id, fromTashkentInput(extend[st.id])))}>{t('hw.extend')}</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Modal>
  )
}
