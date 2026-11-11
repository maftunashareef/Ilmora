'use client'
import { useEffect, useState } from 'react'
import { formatDate, type MatchStatus, type StudentContactRequestDto } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Icon, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { studentApi } from '../../services/studentOpportunities'
import { useStore } from '../../store/useStore'
import { Contacts } from '../institution/common'

const TONE: Record<MatchStatus, 'champagne' | 'forest' | 'danger' | 'muted'> = { PENDING: 'champagne', ACCEPTED: 'forest', DECLINED: 'danger', WITHDRAWN: 'muted' }

/**
 * «Запросы от компаний» (ТЗ 5.1, 5.3, 8): companies ask to see the student's contacts — from a graduation announcement
 * or the contract-help card. Accepting opens the full card (name, phone, e-mail, certificates) to that company and shows
 * the company's contacts; the student can take the access back later.
 */
export function StudentRequests() {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [answer, setAnswer] = useState<{ list?: StudentContactRequestDto[]; error?: unknown } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    studentApi.contactRequests().then((list) => { if (live) setAnswer({ list }) }, (error) => { if (live) setAnswer({ error }) })
    return () => { live = false }
  }, [])
  const act = async (key: string, fn: () => Promise<StudentContactRequestDto[]>, done: string) => {
    setBusy(key)
    try { setAnswer({ list: await fn() }); notify(done) } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }

  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('st.r.title')} subtitle={t('st.r.hint')} />
      {answer?.error != null && <Notice tone="warn">{apiErrorText(answer.error, lang)}</Notice>}
      {!answer && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {answer?.list && answer.list.length === 0 && <EmptyState icon={<Icon name="chat" className="h-6 w-6" />} title={t('st.r.empty')} body={t('st.r.emptyHint')} />}
      <ul className="space-y-3">
        {answer?.list?.map((r) => (
          <li key={r.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-display text-xl text-charcoal">{r.company.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-charcoal/60">
                    <Badge tone="sage">{t(`st.r.source.${r.source}`)}</Badge>
                    {r.company.region && <span className="inline-flex items-center gap-1"><Icon name="pin" className="h-3 w-3" />{tr(r.company.region.name)}</span>}
                    {r.company.industries.length > 0 && <span>{r.company.industries.map((i) => tr(i.name)).join(', ')}</span>}
                    <span>{formatDate(r.createdAt, lang)}</span>
                  </div>
                </div>
                <Badge tone={TONE[r.status]}>{t(`st.r.status.${r.status}`)}</Badge>
              </div>
              {r.company.about && <p className="mt-3 text-sm text-charcoal/75">{r.company.about}</p>}
              {r.status === 'PENDING' && (
                <div className="mt-4 border-t border-charcoal/8 pt-4">
                  <p className="text-xs text-charcoal/60">{t('st.r.acceptHint')}</p>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(`d-${r.id}`, () => studentApi.declineRequest(r.id), t('st.r.declined'))}>{t('st.r.decline')}</Button>
                    <Button size="sm" disabled={busy !== null} onClick={() => void act(`a-${r.id}`, () => studentApi.acceptRequest(r.id), t('st.r.accepted'))}><Icon name="check" className="h-3.5 w-3.5" />{t('st.r.accept')}</Button>
                  </div>
                </div>
              )}
              {r.status === 'ACCEPTED' && r.contacts && (
                <>
                  <Contacts contacts={r.contacts} title={t('st.r.companyContacts')} />
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" variant="ghost" className="text-red-800" disabled={busy !== null}
                      onClick={() => { if (confirm(t('st.r.revokeConfirm'))) void act(`r-${r.id}`, () => studentApi.revokeRequest(r.id), t('st.r.revoked')) }}>{t('st.r.revoke')}</Button>
                  </div>
                </>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
