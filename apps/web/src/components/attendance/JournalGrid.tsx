'use client'
import { useCallback, useEffect, useState } from 'react'
import { JOURNAL_MARKS, studyLabel, type JournalMark } from '@ilmora/shared'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDayMonth } from '../../lib/format'
import { journalApi, type Journal, type JournalRow, type JournalSession } from '../../services/centerStudents'
import { useStore } from '../../store/useStore'
import { Badge, EmptyState, Input, Notice } from '../ui'
import { cx } from '../ui/helpers'

const SHORT: Record<string, string> = { PRESENT: '✓', LATE: '◔', ABSENT: '✕', EXCUSED: '○' }
const TONE: Record<string, string> = { PRESENT: 'bg-forest/10 text-forest', LATE: 'bg-amber-100 text-amber-900', ABSENT: 'bg-red-50 text-red-800', EXCUSED: 'bg-sage text-forest' }

/**
 * The group journal (ТЗ 2026-11-18, 5): rows — the group's students, columns — the lessons of the month. A cell of the
 * center's own student cycles «был → опоздал → не был → —» for a lesson of today or earlier; a student who came through
 * ILMORA shows the QR check-in, read-only. Attendance % counts every past lesson.
 */
export function JournalGrid({ groupId }: { groupId: string }) {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [month, setMonth] = useState<string | undefined>(undefined)
  const [data, setData] = useState<Journal | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(() => journalApi.get(groupId, month).then((d) => { setData(d); setFailed(null) }, (e) => setFailed(apiErrorText(e, lang))), [groupId, month, lang])
  useEffect(() => { void load() }, [load])

  const next = (current: string | undefined): JournalMark | null => {
    const order: (JournalMark | null)[] = [...JOURNAL_MARKS.filter((m) => m !== 'ABSENT'), 'ABSENT', null]
    // was → late → absent → cleared → was …
    const i = order.indexOf((current ?? null) as JournalMark | null)
    return i < 0 ? 'PRESENT' : order[(i + 1) % order.length]
  }
  const mark = async (row: JournalRow, s: JournalSession) => {
    if (!data || !row.editable || !s.markable) return
    const key = `${row.id}:${s.id}`
    const status = next(row.marks[s.id]?.status)
    setSaving(key)
    try {
      await journalApi.mark(groupId, { sessionId: s.id, centerStudentId: row.id, status })
      await load()
    } catch (e) {
      notify(isApiError(e) && e.code === 'forbidden' && (e.details as { code?: string } | undefined)?.code === 'qr_read_only' ? t('journal.err.qrReadOnly') : apiErrorText(e, lang), 'warn')
    } finally { setSaving(null) }
  }

  if (failed) return <Notice tone="warn">{failed}</Notice>
  if (!data) return <p className="py-8 text-center text-sm text-charcoal/55">{t('common.loading')}</p>
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="text-sm text-charcoal/60">{tr(data.group.courseTitle)} · {data.group.name} · {data.group.centerName}</div>
        <label className="flex items-center gap-2 text-sm text-charcoal/70">{t('journal.month')}<Input type="month" value={data.month} onChange={(e) => setMonth(e.target.value || undefined)} className="w-40" /></label>
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-charcoal/60">
        {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const).map((m) => <span key={m} className="inline-flex items-center gap-1.5"><span className={cx('inline-flex h-5 w-5 items-center justify-center rounded', TONE[m])}>{SHORT[m]}</span>{t(`journal.mark.${m}`)}</span>)}
      </div>
      <Notice tone="info" className="mb-4 text-xs">{t('journal.manualHint')} {t('journal.qrReadOnly')}</Notice>
      {data.rows.length === 0 ? <EmptyState title={t('journal.noStudents')} /> : data.sessions.length === 0 ? <EmptyState title={t('journal.noSessions')} /> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-ivory/70 text-[11px] uppercase tracking-wider text-charcoal/50">
              <tr>
                <th className="sticky left-0 z-10 min-w-48 bg-ivory px-4 py-3 text-left">{t('common.student')}</th>
                {data.sessions.map((s) => (
                  <th key={s.id} className={cx('px-1.5 py-3 text-center font-medium', s.status === 'cancelled' && 'line-through opacity-50')} title={s.status === 'cancelled' ? t('journal.cancelled') : !s.markable ? t('journal.notYet') : undefined}>{formatDayMonth(s.date, lang)}</th>
                ))}
                <th className="px-3 py-3 text-right">{t('journal.percent')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-charcoal/8">
              {data.rows.map((row) => (
                <tr key={`${row.kind}:${row.id}`}>
                  <td className="sticky left-0 z-10 bg-paper px-4 py-2">
                    <div className="font-medium text-charcoal">{row.name}</div>
                    <div className="text-[11px] text-charcoal/50">{studyLabel(lang, { institutionType: row.institution?.type ?? null, institutionName: row.institution?.name ?? null, studyYear: row.studyYear, centerName: data.group.centerName })}</div>
                    <Badge tone={row.kind === 'ilmora' ? 'champagne' : 'sage'} className="mt-1">{t(row.kind === 'ilmora' ? 'cs.source.ILMORA' : 'cs.source.CENTER')}</Badge>
                  </td>
                  {data.sessions.map((s) => {
                    const m = row.marks[s.id]?.status
                    const can = row.editable && s.markable
                    const label = m ? t(`journal.mark.${m}` as 'journal.mark.PRESENT') : can ? t('journal.mark.clear') : s.status === 'cancelled' ? t('journal.cancelled') : !s.markable ? t('journal.notYet') : t('journal.qrReadOnly')
                    return (
                      <td key={s.id} className="px-1 py-2 text-center">
                        <button type="button" disabled={!can || saving === `${row.id}:${s.id}`} onClick={() => void mark(row, s)} title={label} aria-label={`${row.name}, ${formatDayMonth(s.date, lang)}: ${label}`}
                          className={cx('inline-flex h-8 w-8 items-center justify-center rounded text-sm transition', m ? TONE[m] : 'bg-charcoal/5 text-charcoal/30', can ? 'hover:ring-2 hover:ring-forest/30' : 'cursor-default', !can && !m && 'opacity-40')}>
                          {m ? SHORT[m] : '·'}
                        </button>
                      </td>
                    )
                  })}
                  <td className="whitespace-nowrap px-3 py-2 text-right"><Badge tone={row.attendance.percent === null ? 'muted' : row.attendance.percent >= 75 ? 'sage' : 'warn'}>{row.attendance.percent === null ? '—' : `${row.attendance.percent}%`}</Badge><div className="mt-0.5 text-[11px] text-charcoal/45">{row.attendance.attended}/{row.attendance.total}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
