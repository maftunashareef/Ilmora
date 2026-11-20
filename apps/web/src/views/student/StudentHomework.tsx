'use client'
import { useCallback, useEffect, useState } from 'react'
import { isSafeExternalUrl } from '@ilmora/shared'
import { tashkentDateTime } from '../../components/homework/homeworkFormat'
import { Badge, Button, EmptyState, Field, Input, Modal, Notice, PageTitle, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { studentHomeworkApi, type StudentHomework as Item, type StudentHomeworkDetail } from '../../services/centerStudents'
import { useStore } from '../../store/useStore'

const stateTone = { missing: 'muted', submitted: 'sage', late: 'warn' } as const

/** The student's homework (ТЗ 2026-11-18, 8.2): from every group they are in — by subscription or as a center's student. */
export function StudentHomework() {
  const { t, tr, lang } = useT()
  const [items, setItems] = useState<Item[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const load = useCallback(() => studentHomeworkApi.list().then(setItems, (e) => setFailed(apiErrorText(e, lang))), [lang])
  useEffect(() => { void load() }, [load])
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('hw.mine')} />
      {failed && <Notice tone="warn">{failed}</Notice>}
      {items && items.length === 0 && <EmptyState title={t('hw.empty')} />}
      <ul className="space-y-3">
        {items?.map((h) => (
          <li key={h.id}>
            <button type="button" onClick={() => setOpenId(h.id)} className="card w-full p-4 text-left transition hover:shadow-lift">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><div className="font-medium text-charcoal">{h.title}</div><div className="mt-0.5 text-xs text-charcoal/55">{tr(h.group.courseTitle)} · {h.group.name} · {h.group.centerName}</div></div>
                <div className="flex flex-wrap gap-1.5"><Badge tone={stateTone[h.state]}>{t(`hw.state.${h.state}`)}</Badge>{h.last?.grade && <Badge tone="forest">{t('hw.graded', { grade: h.last.grade })}</Badge>}</div>
              </div>
              <div className="mt-2 text-xs text-charcoal/55">{t('hw.dueAt', { date: tashkentDateTime(h.deadline, lang) })}{h.extendedTo && <> · {t('hw.extendedTo', { date: tashkentDateTime(h.extendedTo, lang) })}</>}</div>
            </button>
          </li>
        ))}
      </ul>
      {openId && <HomeworkDetail id={openId} onClose={() => { setOpenId(null); void load() }} />}
    </div>
  )
}

function HomeworkDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [data, setData] = useState<StudentHomeworkDetail | null>(null)
  const [text, setText] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => studentHomeworkApi.detail(id).then(setData, (e) => notify(apiErrorText(e, lang), 'warn')), [id, lang, notify])
  useEffect(() => { void load() }, [load])
  const modes = data?.homework.submitModes ?? []
  const linkBad = link.trim() !== '' && !isSafeExternalUrl(link.trim())
  const submit = async () => {
    if (!text.trim() && !link.trim()) { notify(t('hw.needOne'), 'warn'); return }
    if (linkBad) { notify(t('hw.badLink'), 'warn'); return }
    setBusy(true)
    try {
      await studentHomeworkApi.submit(id, { text: text.trim() || null, link: link.trim() || null })
      setText(''); setLink(''); notify(t('common.saved')); await load()
    } catch (e) { notify(isApiError(e) && e.code === 'homework_closed' ? t('hw.err.closed') : isApiError(e) && e.code === 'homework_mode' ? t('hw.err.mode') : apiErrorText(e, lang), 'warn') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} wide title={data?.homework.title ?? t('hw.title')}>
      {!data ? <p className="text-sm text-charcoal/55">{t('common.loading')}</p> : (
        <div>
          <p className="whitespace-pre-wrap text-sm text-charcoal/80">{data.homework.description}</p>
          {data.homework.links.length > 0 && <ul className="mt-2 space-y-1 text-sm">{data.homework.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noopener noreferrer" className="break-all text-forest underline">{l}</a></li>)}</ul>}
          <p className="mt-2 text-xs text-charcoal/55">{t('hw.dueAt', { date: tashkentDateTime(data.deadline, lang) })}</p>
          {data.submissions[0] && (
            <div className="mt-4 rounded-control bg-ivory/70 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Badge tone={stateTone[data.state]}>{t(`hw.state.${data.state}`)}</Badge>{data.submissions[0].grade ? <Badge tone="forest">{t('hw.graded', { grade: data.submissions[0].grade })}</Badge> : <span className="text-xs text-charcoal/50">{t('hw.notGraded')}</span>}</div>
              {data.submissions[0].comment && <p className="mt-2 whitespace-pre-wrap text-charcoal/80"><span className="text-xs text-charcoal/50">{t('hw.comment')}: </span>{data.submissions[0].comment}</p>}
            </div>
          )}
          {data.open ? (
            <div className="mt-5 grid gap-3">
              {modes.includes('TEXT') && <Field label={t('hw.yourText')}><Textarea rows={5} maxLength={10_000} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
              {modes.includes('LINK') && <Field label={t('hw.yourLink')} hint={t('hw.linkSafety')}><Input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://github.com/…" />{linkBad && <p className="mt-1 text-xs text-red-700">{t('hw.badLink')}</p>}</Field>}
              <div><Button disabled={busy} onClick={() => void submit()}>{data.submissions.length ? t('hw.resubmit') : t('hw.submit')}</Button></div>
            </div>
          ) : <Notice tone="warn" className="mt-5">{t('hw.closed')}</Notice>}
          {data.submissions.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-charcoal/50">{t('hw.history')}</div>
              <ul className="space-y-2 text-sm">
                {data.submissions.map((s) => (
                  <li key={s.id} className="rounded-control border border-charcoal/10 p-3">
                    <div className="text-xs text-charcoal/50">{t('hw.submittedAt', { date: tashkentDateTime(s.submittedAt, lang) })}{s.grade ? ` · ${t('hw.graded', { grade: s.grade })}` : ''}</div>
                    {s.text && <p className="mt-1 whitespace-pre-wrap text-charcoal/85">{s.text}</p>}
                    {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-forest underline">{s.link}</a>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
