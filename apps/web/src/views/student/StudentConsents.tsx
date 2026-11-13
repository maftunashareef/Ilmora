'use client'
import { useEffect, useState } from 'react'
import { formatDate, formatTime, type StudentConsentActionKind, type StudentConsentDto } from '@ilmora/shared'
import { Badge, Button, Card, Icon, LinkButton, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { CONSENT_TEXT, consentRows, consentsApi, REVOKE_WARNING } from '../../services/consents'
import { useQuestionnaire } from '../../services/questionnaire'
import { useStore } from '../../store/useStore'

/**
 * «Мои согласия» (ТЗ 8): the consents in force with «Дать согласие» / «Отозвать» — each button is its own request, sent
 * at once and apart from the questionnaire — and the journal: what was given and taken back and when, and which
 * company the contacts were opened to. Before a revocation the student is told what it does, by kind.
 */
export function StudentConsents() {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const { data: q, status: qStatus, reload: reloadQuestionnaire } = useQuestionnaire()
  const [answer, setAnswer] = useState<{ list?: StudentConsentDto[]; error?: unknown } | null>(null)
  const [busy, setBusy] = useState<StudentConsentActionKind | null>(null)
  useEffect(() => {
    let live = true
    consentsApi.journal().then((list) => { if (live) setAnswer({ list }) }, (error) => { if (live) setAnswer({ error }) })
    return () => { live = false }
  }, [])

  const act = async (kind: StudentConsentActionKind, fn: () => Promise<StudentConsentDto[]>, done: string) => {
    setBusy(kind)
    try {
      setAnswer({ list: await fn() })
      notify(done)
    } catch (e) {
      notify(apiErrorText(e, lang), 'warn')
      // The questionnaire or the journal may have changed in another tab: show what is true now.
      void reloadQuestionnaire()
      consentsApi.journal().then((list) => setAnswer({ list }), () => undefined)
    } finally {
      setBusy(null)
    }
  }
  const when = (iso: string) => `${formatDate(iso, lang)}, ${formatTime(iso, lang)}`

  const questionnaire = q?.questionnaire ?? null
  const ready = qStatus !== 'loading' && !!answer?.list
  const rows = ready ? consentRows(questionnaire, answer!.list!, new Date()) : []
  const parent = rows.find((r) => r.kind === 'PARENT_CONSENT')
  const journal = answer?.list ?? []

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('st.c.title')} subtitle={t('st.c.hint')} />
      {answer?.error != null && <Notice tone="warn">{apiErrorText(answer.error, lang)}</Notice>}
      {qStatus === 'error' && <Notice tone="warn">{t('apiError.unavailable')}</Notice>}
      {!ready && answer?.error == null && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}

      {ready && (
        <section aria-labelledby="consents-current">
          <h2 id="consents-current" className="mb-3 font-display text-2xl text-charcoal">{t('st.c.current')}</h2>
          {qStatus === 'ready' && !questionnaire && (
            <Notice className="mb-3">
              <span className="flex flex-wrap items-center justify-between gap-3">{t('st.c.block.questionnaire_required')}<LinkButton to="/student/questionnaire" size="sm">{t('q.banner.action')}</LinkButton></span>
            </Notice>
          )}
          {parent && !parent.active && <Notice tone="warn" className="mb-3">{t('st.c.parentMissing')}</Notice>}
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.kind}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-sm font-medium leading-relaxed text-charcoal">{t(CONSENT_TEXT[r.kind])}</p>
                    <Badge tone={r.active ? 'forest' : 'muted'}>{r.active ? t('st.c.inForce') : t('st.c.notGiven')}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs leading-relaxed text-charcoal/60">
                      {r.active
                        ? <>{t('st.c.givenAt', { date: when(r.active.givenAt) })}{r.kind === 'INDUSTRY_CARD' && questionnaire?.status === 'APPLYING' && <span className="block">{t('st.c.applyingNote')}</span>}</>
                        : r.block && r.block !== 'questionnaire_required' ? t(`st.c.block.${r.block}`) : null}
                    </p>
                    {r.active
                      ? <Button size="sm" variant="ghost" className="text-red-800" disabled={busy !== null}
                          onClick={() => { if (confirm(t(REVOKE_WARNING[r.kind]))) void act(r.kind, () => consentsApi.revoke(r.kind), t('st.c.revoked')) }}>{t('st.c.revoke')}</Button>
                      : <Button size="sm" disabled={busy !== null || r.block !== null} onClick={() => void act(r.kind, () => consentsApi.give(r.kind), t('st.c.given'))}>
                          {busy === r.kind ? <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" /> : <Icon name="check" className="h-3.5 w-3.5" />}{t('st.c.give')}
                        </Button>}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {answer?.list && (
        <section className="mt-10" aria-labelledby="consents-journal">
          <h2 id="consents-journal" className="font-display text-2xl text-charcoal">{t('st.c.journal')}</h2>
          <p className="mb-3 mt-1 text-sm text-charcoal/60">{t('st.c.journalHint')}</p>
          {journal.length === 0
            ? <p className="text-sm text-charcoal/55">{t('st.c.journalEmpty')}</p>
            : (
              <Card padded={false}>
                <ul className="divide-y divide-charcoal/8">
                  {journal.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="text-charcoal">{c.kind === 'COMPANY_CONTACTS' ? t('st.c.kind.COMPANY_CONTACTS', { company: c.company?.name ?? '—' }) : t(CONSENT_TEXT[c.kind])}</p>
                        <p className="mt-0.5 text-xs text-charcoal/55">
                          {t('st.c.givenAt', { date: when(c.givenAt) })}
                          {c.revokedAt && <> · {t('st.c.revokedAt', { date: when(c.revokedAt) })}</>}
                          {c.kind !== 'COMPANY_CONTACTS' && <> · {t('st.c.textVersion', { version: c.textVersion })}</>}
                        </p>
                      </div>
                      {c.active && <Badge tone="sage">{t('st.c.inForce')}</Badge>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          {journal.some((c) => c.kind === 'COMPANY_CONTACTS' && c.active) && (
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal/60">{t('st.c.contactsNote')}<LinkButton to="/student/requests" variant="ghost" size="sm">{t('st.r.title')}</LinkButton></p>
          )}
        </section>
      )}
    </div>
  )
}
