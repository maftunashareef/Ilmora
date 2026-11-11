'use client'
import { useEffect, useState } from 'react'
import type { InstitutionStudentDto, StudyConfirmationStatus } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Icon, Notice, PageTitle, Tabs } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { institutionApi } from '../../services/institutionCabinet'
import { useStore } from '../../store/useStore'
import { ClosedNotice } from './common'
import { usePassport } from './passportStore'

type Tab = StudyConfirmationStatus | 'all'
const TONE: Record<StudyConfirmationStatus, 'champagne' | 'forest' | 'danger'> = { PENDING: 'champagne', CONFIRMED: 'forest', REJECTED: 'danger' }

/** Students who named the institution (ТЗ 4.1 «Подтверждение учёбы»): confirm or reject; name, course, direction, year — no contacts. */
export function InstitutionStudents() {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const { passport } = usePassport()
  const open = !!passport?.workspaceOpen
  const [tab, setTab] = useState<Tab>('PENDING')
  const [answer, setAnswer] = useState<{ tab: Tab; list?: InstitutionStudentDto[]; error?: unknown } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!open) return
    let live = true
    institutionApi.students(tab === 'all' ? undefined : tab).then((list) => { if (live) setAnswer({ tab, list }) }, (error) => { if (live) setAnswer({ tab, error }) })
    return () => { live = false }
  }, [open, tab, round])

  if (passport && !open) return <div><PageTitle eyebrow={t('dash.institution')} title={t('inst.s.title')} /><ClosedNotice /></div>
  const current = answer?.tab === tab ? answer : null

  const decide = async (s: InstitutionStudentDto, confirm: boolean) => {
    setBusy(s.id)
    try {
      await (confirm ? institutionApi.confirm(s.id) : institutionApi.reject(s.id))
      notify(t(confirm ? 'inst.s.confirmed' : 'inst.s.rejected', { name: s.name }))
      setRound((r) => r + 1)
    } catch (e) {
      notify(apiErrorText(e, lang), 'warn')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageTitle eyebrow={t('dash.institution')} title={t('inst.s.title')} subtitle={t('inst.s.hint')} />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={(['PENDING', 'CONFIRMED', 'REJECTED', 'all'] as Tab[]).map((x) => ({ id: x, label: t(`inst.s.tab.${x}`) }))} />
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.list && current.list.length === 0 && <EmptyState icon={<Icon name="users" className="h-6 w-6" />} title={t('inst.s.empty')} />}
      {current?.list && current.list.length > 0 && (
        <ul className="space-y-2" aria-label={t('inst.s.title')}>
          {current.list.map((s) => (
            <li key={s.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-charcoal">{s.name}</span>
                    <Badge tone={TONE[s.confirmation]}>{t(`inst.s.tab.${s.confirmation}`)}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-charcoal/60">
                    {s.direction && <span>{s.direction.name} · {tr(s.direction.industry.name)}</span>}
                    {s.course != null && <span>{t('inst.s.course', { n: s.course })}</span>}
                    {s.graduationYear != null && <span>{t('inst.s.graduation', { year: s.graduationYear })}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.confirmation !== 'REJECTED' && <Button size="sm" variant="ghost" className="text-red-800" disabled={busy !== null} onClick={() => void decide(s, false)}>{t('inst.s.reject')}</Button>}
                  {s.confirmation !== 'CONFIRMED' && <Button size="sm" disabled={busy !== null} onClick={() => void decide(s, true)}><Icon name="check" className="h-3.5 w-3.5" />{t('inst.s.confirm')}</Button>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
