'use client'
import { useEffect, useState } from 'react'
import { formatDate, type CompanyContactDto, type StudentFullCardDto } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Icon, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { companyApi } from '../../services/companyCabinet'
import { useStore } from '../../store/useStore'
import { CompanyClosed, StudentCard } from './common'
import { useCompany } from './companyStore'

/**
 * «Мои контакты» (ТЗ 4.3): students who shared their contacts — accepted contact requests and applications to the
 * company's vacancies. The list carries names; a card is opened one at a time (each opening is logged).
 */
export function CompanyContacts() {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const { profile } = useCompany()
  const open = !!profile?.workspaceOpen
  const [answer, setAnswer] = useState<{ list?: CompanyContactDto[]; error?: unknown } | null>(null)
  const [cards, setCards] = useState<Record<string, StudentFullCardDto>>({})
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    companyApi.contacts().then((list) => { if (live) setAnswer({ list }) }, (error) => { if (live) setAnswer({ error }) })
    return () => { live = false }
  }, [open])

  if (profile && !open) return <div><PageTitle eyebrow={t('dash.company')} title={t('co.c.title')} /><CompanyClosed /></div>
  const toggle = async (c: CompanyContactDto) => {
    if (cards[c.id]) { const next = { ...cards }; delete next[c.id]; setCards(next); return }
    setBusy(c.id)
    try {
      const full = c.source === 'VACANCY' ? (await companyApi.application(c.id)).student : (await companyApi.contact(c.id)).student.full
      if (full) setCards({ ...cards, [c.id]: full })
    } catch (e) {
      notify(apiErrorText(e, lang), 'warn')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div>
      <PageTitle eyebrow={t('dash.company')} title={t('co.c.title')} subtitle={t('co.c.hint')} />
      {answer?.error != null && <Notice tone="warn">{apiErrorText(answer.error, lang)}</Notice>}
      {!answer && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {answer?.list && answer.list.length === 0 && <EmptyState icon={<Icon name="user" className="h-6 w-6" />} title={t('co.c.empty')} />}
      <ul className="space-y-2">
        {answer?.list?.map((c) => (
          <li key={c.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-charcoal">{c.student.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-charcoal/60">
                    <Badge tone="sage">{t(`co.c.source.${c.source}`)}</Badge>
                    {c.vacancy && <span>{c.vacancy.title}</span>}
                    <span>{formatDate(c.decidedAt ?? c.createdAt, lang)}</span>
                  </div>
                </div>
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void toggle(c)}>
                  {busy === c.id ? <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" /> : <Icon name={cards[c.id] ? 'up' : 'eye'} className="h-3.5 w-3.5" />}{t(cards[c.id] ? 'co.c.hide' : 'co.c.open')}
                </Button>
              </div>
              {cards[c.id] && <StudentCard card={cards[c.id]} openFile={(certId) => (c.source === 'VACANCY' ? companyApi.applicationFile(c.id, certId) : companyApi.contactFile(c.id, certId))} />}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
