'use client'
import { useEffect, useState } from 'react'
import { STUDY_YEAR_MAX } from '@ilmora/shared'
import { InstitutionPicker, type InstitutionValue } from '../../components/center/InstitutionPicker'
import { Button, Card, Eyebrow, Field, Icon, Input, LinkButton, Notice } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { pendingInvite } from '../../lib/pendingInvite'
import { studentCentersApi, type InvitePreview } from '../../services/centerStudents'
import { useStore } from '../../store/useStore'

type State = { kind: 'loading' } | { kind: 'invalid' } | { kind: 'signin' } | { kind: 'notStudent' } | { kind: 'ready'; invite: InvitePreview } | { kind: 'done'; centerName: string } | { kind: 'already' } | { kind: 'error'; text: string }

/**
 * A center's invitation (ТЗ 2026-11-18, 4.3): /invite#<token>. The student signs in or registers under their own name
 * and phone, checks or corrects where they study, and accepts; the center's record is linked to the account. The token
 * goes to the API in a request body only.
 */
export function InvitePage() {
  const { t, lang } = useT()
  const auth = useStore((s) => s.auth)
  // Read once on the client (the fragment and sessionStorage do not exist on the server).
  const [token] = useState<string | null | undefined>(() => (typeof window === 'undefined' ? undefined : pendingInvite.take()))
  const [result, setResult] = useState<State | null>(null)
  // The token is kept; the address bar and the history lose it (after the router's own first write of the URL).
  useEffect(() => {
    const id = window.setTimeout(() => pendingInvite.stripHash(), 50)
    return () => window.clearTimeout(id)
  }, [])
  const [institution, setInstitution] = useState<InstitutionValue | null>(null)
  const [studyYear, setStudyYear] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const student = auth.status === 'authenticated' && !!auth.user?.roles.includes('STUDENT')
  const state: State = result
    ?? (token === undefined || auth.status === 'idle' || auth.status === 'loading' ? { kind: 'loading' }
      : !token ? { kind: 'invalid' }
        : auth.status !== 'authenticated' ? { kind: 'signin' }
          : !student ? { kind: 'notStudent' } : { kind: 'loading' })
  useEffect(() => {
    if (!token || !student) return
    let live = true
    studentCentersApi.preview(token).then(
      (invite) => {
        if (!live) return
        setInstitution(invite.institution)
        setStudyYear(invite.studyYear)
        setResult({ kind: 'ready', invite })
      },
      (e) => {
        if (!live) return
        if (isApiError(e) && e.code === 'invite_invalid') { pendingInvite.clear(); setResult({ kind: 'invalid' }) } else setResult({ kind: 'error', text: apiErrorText(e, lang) })
      },
    )
    return () => { live = false }
  }, [token, student, lang])

  const accept = async () => {
    if (!token) return
    setBusy(true)
    try {
      const res = await studentCentersApi.accept({ token, institutionId: institution?.id ?? null, institutionText: institution && !institution.id ? institution.name.trim() || null : null, institutionType: institution?.type ?? null, studyYear })
      pendingInvite.clear()
      setResult({ kind: 'done', centerName: res.centerName })
    } catch (e) {
      if (isApiError(e) && e.code === 'invite_invalid') { pendingInvite.clear(); setResult({ kind: 'invalid' }) }
      else if (isApiError(e) && e.code === 'invite_already_member') { pendingInvite.clear(); setResult({ kind: 'already' }) }
      else setResult({ kind: 'error', text: apiErrorText(e, lang) })
    } finally { setBusy(false) }
  }

  return (
    <div className="container-x py-14 lg:py-20">
      <div className="mx-auto max-w-xl">
        <Eyebrow className="mb-2">{t('invite.title')}</Eyebrow>
        <Card className="px-6 py-8 sm:px-8">
          {state.kind === 'loading' && <p className="text-sm text-charcoal/55">{t('common.loading')}</p>}
          {state.kind === 'invalid' && <Notice tone="warn">{t('invite.invalid')}</Notice>}
          {state.kind === 'error' && <Notice tone="warn">{state.text}</Notice>}
          {state.kind === 'notStudent' && <Notice tone="warn">{t('invite.notStudent')}</Notice>}
          {state.kind === 'already' && <Notice tone="info">{t('invite.already')}</Notice>}
          {state.kind === 'signin' && (
            <div>
              <p className="text-sm text-charcoal/75">{t('invite.signIn')}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <LinkButton to="/login?next=/invite">{t('invite.signInBtn')}</LinkButton>
                <LinkButton to="/login?mode=register&next=/invite" variant="secondary">{t('invite.registerBtn')}</LinkButton>
              </div>
            </div>
          )}
          {state.kind === 'ready' && (
            <div>
              <h1 className="font-display text-2xl text-charcoal">{t('invite.from', { center: state.invite.centerName })}</h1>
              <p className="mt-2 text-sm text-charcoal/65">{t('invite.forName', { name: state.invite.fullName })}</p>
              {state.invite.groups.length > 0 && <p className="mt-1 text-xs text-charcoal/55">{state.invite.groups.map((g) => `${g.courseTitle[lang] || g.courseTitle.en} · ${g.name}`).join(', ')}</p>}
              <div className="mt-6 rounded-card border border-charcoal/10 p-4">
                <div className="mb-3 text-sm font-medium text-charcoal">{t('invite.checkStudy')}</div>
                <InstitutionPicker value={institution} onChange={setInstitution} />
                <Field label={t('cs.col.studyYear')} className="mt-3 max-w-40"><Input type="number" min={1} max={STUDY_YEAR_MAX} value={studyYear ?? ''} onChange={(e) => setStudyYear(e.target.value ? Math.max(1, Math.min(STUDY_YEAR_MAX, Number(e.target.value))) : null)} /></Field>
              </div>
              <Button className="mt-6" disabled={busy} onClick={() => void accept()}><Icon name="check" className="h-4 w-4" />{t('invite.accept')}</Button>
            </div>
          )}
          {state.kind === 'done' && (
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-forest text-ivory"><Icon name="check" className="h-6 w-6" /></div>
              <p className="text-charcoal">{t('invite.accepted', { center: state.centerName })}</p>
              <LinkButton to="/student/centers" className="mt-6">{t('invite.toCabinet')}</LinkButton>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
