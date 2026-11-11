'use client'
import { useEffect, useState } from 'react'
import type { CompanyAnnouncementDto, MatchStatus } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Field, Icon, Input, Notice, PageTitle, Select, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { useSearchParams } from '../../lib/router'
import { companyApi } from '../../services/companyCabinet'
import { announcementYears } from '../../services/institutionCabinet'
import { useStore } from '../../store/useStore'
import { Contacts } from '../institution/common'
import { CompanyClosed, InstitutionLine } from './common'
import { useCompany } from './companyStore'

const TONE: Record<MatchStatus, 'champagne' | 'forest' | 'danger' | 'muted'> = { PENDING: 'champagne', ACCEPTED: 'forest', DECLINED: 'danger', WITHDRAWN: 'muted' }

/**
 * Graduation announcements of the company's industries (ТЗ 5.1): respond with how many people from which lines, or ask a
 * graduate for contacts — the graduate decides. `?a=<id>` opens one announcement with the graduates' cards.
 */
export function CompanyGraduates() {
  const { t, lang } = useT()
  const { profile } = useCompany()
  const open = !!profile?.workspaceOpen
  const [sp, setSp] = useSearchParams()
  const selected = sp.get('a')
  const [year, setYear] = useState('')
  const [answer, setAnswer] = useState<{ key: string; list?: CompanyAnnouncementDto[]; error?: unknown } | null>(null)
  const key = `${year}`
  useEffect(() => {
    if (!open || selected) return
    let live = true
    companyApi.announcements(year ? Number(year) : undefined).then((list) => { if (live) setAnswer({ key, list }) }, (error) => { if (live) setAnswer({ key, error }) })
    return () => { live = false }
  }, [open, selected, year, key])

  if (profile && !open) return <div><PageTitle eyebrow={t('dash.company')} title={t('co.g.title')} /><CompanyClosed /></div>
  if (selected) return <AnnouncementView id={selected} onBack={() => setSp({})} />
  const current = answer?.key === key ? answer : null
  return (
    <div>
      <PageTitle eyebrow={t('dash.company')} title={t('co.g.title')} subtitle={t('co.g.hint')} />
      <div className="mb-4 w-full sm:w-56">
        <Select aria-label={t('inst.g.year')} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">{t('min.filter.allYears')}</option>
          {announcementYears().map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.list && current.list.length === 0 && <EmptyState icon={<Icon name="users" className="h-6 w-6" />} title={t('co.g.empty')} />}
      <ul className="space-y-2">
        {current?.list?.map((a) => (
          <li key={a.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <InstitutionLine institution={a.institution} />
                <div className="mt-1 text-sm text-charcoal/75">{t('inst.g.headline', { year: a.year })} · {t('inst.g.total', { n: a.total })}</div>
                <div className="mt-0.5 text-xs text-charcoal/55">{a.lines.map((l) => `${l.direction.name} — ${l.count}`).join(' · ')}</div>
              </div>
              <div className="flex items-center gap-2">
                {a.myResponse && <Badge tone={TONE[a.myResponse.status]}>{t(`inst.r.status.${a.myResponse.status}`)}</Badge>}
                <Button size="sm" variant="secondary" onClick={() => setSp({ a: a.id }, { replace: false })}>{t('inst.g.open')}<Icon name="arrowRight" className="h-3.5 w-3.5" /></Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AnnouncementView({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [ann, setAnn] = useState<{ id: string; round: number; data?: CompanyAnnouncementDto; error?: unknown } | null>(null)
  const [round, setRound] = useState(0)
  const [wanted, setWanted] = useState<Record<string, string> | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    companyApi.announcement(id).then((data) => { if (live) setAnn({ id, round, data }) }, (error) => { if (live) setAnn({ id, round, error }) })
    return () => { live = false }
  }, [id, round])

  const back = <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal/60 hover:text-forest"><Icon name="arrowLeft" className="h-4 w-4" />{t('inst.g.back')}</button>
  const a = ann?.id === id ? ann.data : undefined
  if (ann?.id === id && ann.error != null) return <div>{back}<Notice tone="warn">{apiErrorText(ann.error, lang)}</Notice></div>
  if (!a) return <div>{back}<p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p></div>

  const lines = wanted ? Object.entries(wanted).filter(([, n]) => Number(n) >= 1).map(([lineId, n]) => ({ lineId, wantedCount: Number(n) })) : []
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try { await fn(); notify(done); setWanted(null); setRound((n) => n + 1) } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }

  return (
    <div>
      {back}
      <PageTitle eyebrow={a.institution.name} title={t('inst.g.headline', { year: a.year })} subtitle={t('inst.g.total', { n: a.total })} />
      <Card className="mb-6">
        <InstitutionLine institution={a.institution} />
        <ul className="mt-3 divide-y divide-charcoal/8 rounded-control border border-charcoal/10">
          {a.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>{l.direction.name} <span className="text-charcoal/55">· {tr(l.direction.industry.name)}</span></span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-charcoal/75">{l.count}</span>
                {wanted && <Input aria-label={`${t('co.g.wanted')}: ${l.direction.name}`} className="w-24" inputMode="numeric" placeholder="0" value={wanted[l.id] ?? ''}
                  onChange={(e) => setWanted({ ...wanted, [l.id]: e.target.value.replace(/\D/g, '').slice(0, 5) })} />}
              </span>
            </li>
          ))}
        </ul>
        {a.myResponse ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{t('co.g.myResponse')}</span><Badge tone={TONE[a.myResponse.status]}>{t(`inst.r.status.${a.myResponse.status}`)}</Badge></div>
            <ul className="mt-1 text-sm text-charcoal/75">{a.myResponse.lines.map((ml) => <li key={ml.lineId}>{t('inst.g.wanted', { direction: a.lines.find((l) => l.id === ml.lineId)?.direction.name ?? '—', n: ml.wantedCount })}</li>)}</ul>
            {a.myResponse.contacts && <Contacts contacts={a.myResponse.contacts} title={t('co.r.contacts')} />}
          </div>
        ) : wanted ? (
          <div className="mt-4 grid gap-3">
            <p className="text-xs text-charcoal/55">{t('co.g.wanted')}</p>
            <Field label={t('inst.r.comment')}><Textarea rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setWanted(null)}>{t('common.cancel')}</Button>
              <Button disabled={busy !== null || lines.length === 0} onClick={() => void act('respond', () => companyApi.respond(a.id, lines, comment), t('co.g.sent'))}><Icon name="check" className="h-4 w-4" />{t('co.g.send')}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex justify-end"><Button onClick={() => setWanted({})}><Icon name="megaphone" className="h-4 w-4" />{t('co.g.respond')}</Button></div>
        )}
      </Card>

      <h2 className="mb-3 font-display text-xl text-charcoal">{t('co.g.graduates', { n: a.graduates?.length ?? 0 })}</h2>
      {!a.graduates?.length && <p className="text-sm text-charcoal/55">{t('co.g.noGraduates')}</p>}
      <ul className="space-y-3">
        {a.graduates?.map((g) => (
          <li key={g.studentId}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-charcoal">{g.name}</div>
                  <div className="mt-0.5 text-xs text-charcoal/60">{g.direction.name} · {t('inst.s.graduation', { year: g.graduationYear })}{g.region && <> · {tr(g.region.name)}</>}</div>
                </div>
                <Badge tone="sage"><Icon name="check" className="h-3 w-3" />{t('co.g.confirmed')}</Badge>
              </div>
              {g.about && <p className="mt-2 text-sm text-charcoal/75">{g.about}</p>}
              {g.certificates.length > 0 && <p className="mt-1 text-xs text-charcoal/60">{t('co.g.certificates', { list: g.certificates.join(', ') })}</p>}
              {g.ilmoraCourses.length > 0 && <p className="mt-1 text-xs text-charcoal/60">{t('co.g.ilmoraCourses', { list: g.ilmoraCourses.map((c) => tr(c)).join(', ') })}</p>}
              <div className="mt-3 flex justify-end">
                {g.contactRequest ? <Badge tone={TONE[g.contactRequest]}>{t(`co.g.request.${g.contactRequest}`)}</Badge>
                  : <Button size="sm" disabled={busy !== null} onClick={() => void act(`i-${g.studentId}`, () => companyApi.invite(g.studentId, a.id), t('co.g.invited'))}><Icon name="user" className="h-3.5 w-3.5" />{t('co.g.invite')}</Button>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
