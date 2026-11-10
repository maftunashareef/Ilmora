'use client'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { CompanyReviewDto, CompanyReviewItemDto, InstitutionReviewDto, InstitutionReviewItemDto, TKey } from '@ilmora/shared'
import { Badge, Button, EmptyState, Icon, Modal, Notice, PageTitle, Tabs, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDate, formatTime } from '../../lib/format'
import { nameDiffers, REASON_MAX, REASON_MIN, reasonOk, reviews } from '../../services/reviews'
import { useStore } from '../../store/useStore'

type Kind = 'institutions' | 'companies'
type Open = { kind: Kind; id: string }
type Action = 'reject' | 'release'
type History = { action: string; reason: string | null; at: string; by: string | null }

const HISTORY_KEYS: Record<string, TKey> = {
  'institution.claim': 'rev.h.claim', 'institution.create': 'rev.h.create', 'institution.submit': 'rev.h.submit', 'institution.update.review': 'rev.h.updateReview',
  'institution.approve': 'rev.h.approve', 'institution.reject': 'rev.h.reject',
  'company.create': 'rev.h.companyCreate', 'company.submit': 'rev.h.submit', 'company.update.review': 'rev.h.updateReview', 'company.certificate.review': 'rev.h.certificate',
  'company.approve': 'rev.h.approve', 'company.reject': 'rev.h.reject',
}

/**
 * Super Admin: review of institution and company profiles (decision of 10.11 — the Super Admin decides). The queue shows
 * the name from the ministry's list next to the one the representative entered; the card approves, rejects (with a
 * reason the representative sees) or unlinks the representative of a record that is not theirs (security review №17).
 */
export function AdminReviews() {
  const { t, lang } = useT()
  const [tab, setTab] = useState<Kind>('institutions')
  const [institutions, setInstitutions] = useState<InstitutionReviewItemDto[] | null>(null)
  const [companies, setCompanies] = useState<CompanyReviewItemDto[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [open, setOpen] = useState<Open | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([reviews.institutions.queue(), reviews.companies.queue()]).then(
      ([i, c]) => { if (live) { setInstitutions(i); setCompanies(c); setLoadError(null) } },
      (err) => { if (live) setLoadError(apiErrorText(err, lang)) },
    )
    return () => { live = false }
  }, [lang, round])
  const refresh = useCallback(() => setRound((r) => r + 1), [])
  const close = useCallback(() => setOpen(null), [])
  const list = tab === 'institutions' ? institutions : companies

  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('rev.title')} subtitle={t('rev.hint')} />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[{ id: 'institutions', label: t('rev.institutions'), count: institutions?.length }, { id: 'companies', label: t('rev.companies'), count: companies?.length }]}
      />
      {loadError && <Notice tone="warn" className="mb-4">{loadError} <button type="button" className="ml-1 font-medium underline" onClick={refresh}>{t('admin.ministry.retry')}</button></Notice>}
      {!list && !loadError && <p className="text-sm text-charcoal/55">{t('common.loading')}</p>}
      {list && list.length === 0 && <EmptyState icon={<Icon name="check" className="h-6 w-6" />} title={t('rev.empty')} body={t('rev.emptyBody')} />}
      {tab === 'institutions' && institutions && institutions.length > 0 && (
        <ul className="space-y-2" aria-label={t('rev.institutions')}>
          {institutions.map((it) => <li key={it.id}><InstitutionRow item={it} onOpen={() => setOpen({ kind: 'institutions', id: it.id })} /></li>)}
        </ul>
      )}
      {tab === 'companies' && companies && companies.length > 0 && (
        <ul className="space-y-2" aria-label={t('rev.companies')}>
          {companies.map((it) => <li key={it.id}><CompanyRow item={it} onOpen={() => setOpen({ kind: 'companies', id: it.id })} /></li>)}
        </ul>
      )}
      <Notice tone="info" className="mt-6 text-xs">{t('rev.releaseHint')}</Notice>
      {open && <ReviewCard open={open} onClose={close} onChanged={refresh} />}
    </div>
  )
}

/** The name in the ministry's list next to the entered one: a warning when they differ, a quiet mark when they match. */
function OfficialName({ entered, official, large = false }: { entered: string; official: string | null; large?: boolean }) {
  const { t } = useT()
  if (!official) return null
  if (nameDiffers(entered, official)) {
    return (
      <div className={`mt-1.5 flex items-start gap-1.5 rounded-control border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900 ${large ? 'text-sm' : 'text-xs'}`}>
        <Icon name="warn" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span><span className="font-medium">{t('rev.officialName')}:</span> «{official}» — {t('rev.nameDiffers')}</span>
      </div>
    )
  }
  return <p className={`mt-1 flex items-center gap-1 text-forest ${large ? 'text-sm' : 'text-xs'}`}><Icon name="check" className="h-3.5 w-3.5" />{t('rev.nameMatches')}</p>
}

const when = (iso: string | null, lang: Parameters<typeof formatDate>[1]) => (iso ? `${formatDate(iso, lang)}, ${formatTime(iso, lang)}` : '—')

function InstitutionRow({ item: it, onOpen }: { item: InstitutionReviewItemDto; onOpen: () => void }) {
  const { t, tr, lang } = useT()
  const place = [tr(it.region?.name), it.district ? tr(it.district.name) : it.districtName].filter(Boolean).join(', ')
  return (
    <button type="button" onClick={onOpen} className="card block w-full p-4 text-left transition hover:border-forest/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-charcoal">{it.name}</span>
            <Badge>{t(`inst.type.${it.type}`)}</Badge>
            {it.reReview && <Badge tone="champagne">{t('rev.reReview')}</Badge>}
            {it.inRegistry ? <Badge tone="sage">{t('rev.inRegistry')}</Badge> : <Badge tone="warn">{t('rev.notInRegistry')}</Badge>}
          </div>
          <OfficialName entered={it.name} official={it.officialName} />
          <div className="mt-1 text-xs text-charcoal/60">{[it.stir ? `${t('auth.org.stir')}: ${it.stir}` : null, place || null].filter(Boolean).join(' · ')}</div>
          {it.representative && <div className="text-xs text-charcoal/50">{[it.representative.name, it.representative.jobTitle, it.representative.login ? `@${it.representative.login}` : null].filter(Boolean).join(' · ')}</div>}
        </div>
        <span className="text-[11px] text-charcoal/45">{t('rev.submitted')}: {when(it.submittedAt, lang)}</span>
      </div>
    </button>
  )
}

function CompanyRow({ item: it, onOpen }: { item: CompanyReviewItemDto; onOpen: () => void }) {
  const { t, tr, lang } = useT()
  return (
    <button type="button" onClick={onOpen} className="card block w-full p-4 text-left transition hover:border-forest/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-charcoal">{it.name}</span>
            {it.reReview && <Badge tone="champagne">{t('rev.reReview')}</Badge>}
            {it.certificateUploaded ? <Badge tone="sage">{t('rev.certificateYes')}</Badge> : <Badge tone="warn">{t('rev.certificateNo')}</Badge>}
          </div>
          <div className="mt-1 text-xs text-charcoal/60">{[`${t('auth.org.stir')}: ${it.stir}`, tr(it.region?.name) || null, it.industries.map((x) => tr(x.name)).join(', ') || null].filter(Boolean).join(' · ')}</div>
          {it.representative && <div className="text-xs text-charcoal/50">{[it.representative.name, it.representative.jobTitle, it.representative.email, it.representative.login ? `@${it.representative.login}` : null].filter(Boolean).join(' · ')}</div>}
        </div>
        <span className="text-[11px] text-charcoal/45">{t('rev.submitted')}: {when(it.submittedAt, lang)}</span>
      </div>
    </button>
  )
}

/** One row of the card's facts; empty values are left out. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null
  return <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3 border-b border-charcoal/8 py-2 text-sm last:border-0"><dt className="text-charcoal/55">{label}</dt><dd className="min-w-0 break-words text-charcoal">{children}</dd></div>
}

function HistoryList({ items }: { items: History[] }) {
  const { t, lang } = useT()
  if (!items.length) return null
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-body text-xs font-semibold uppercase tracking-wider text-charcoal/50">{t('rev.history')}</h3>
      <ol className="space-y-1.5 text-sm">
        {items.map((h, i) => (
          <li key={`${h.at}-${i}`} className="flex flex-wrap gap-x-2 text-charcoal/80">
            <span className="text-xs tabular-nums text-charcoal/45">{when(h.at, lang)}</span>
            <span>{HISTORY_KEYS[h.action] ? t(HISTORY_KEYS[h.action]) : h.action}</span>
            {h.by && <span className="text-charcoal/50">· {h.by}</span>}
            {h.reason && <span className="w-full text-xs text-charcoal/60">«{h.reason}»</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** The card of one profile with its decisions: approve, reject (reason), unlink the representative (reason). */
function ReviewCard({ open, onClose, onChanged }: { open: Open; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [inst, setInst] = useState<InstitutionReviewDto | null>(null)
  const [comp, setComp] = useState<CompanyReviewDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const closeAction = useCallback(() => setAction(null), [])
  const api = open.kind === 'institutions' ? reviews.institutions : reviews.companies

  useEffect(() => {
    let live = true
    const load = open.kind === 'institutions' ? reviews.institutions.detail(open.id).then((d) => { if (live) setInst(d) }) : reviews.companies.detail(open.id).then((d) => { if (live) setComp(d) })
    load.catch((err) => { if (live) setError(apiErrorText(err, lang)) })
    return () => { live = false }
  }, [open, lang])

  const status = inst?.passport.status ?? comp?.profile.status
  const name = inst?.passport.name ?? comp?.profile.name ?? ''
  const representative = inst ? inst.representative : comp?.representative ?? null
  const pending = status === 'PENDING'

  const done = (text: string) => { notify(text); onChanged(); onClose() }
  const approve = async () => {
    setBusy(true); setError(null)
    try { await api.approve(open.id); done(t('rev.approved', { name })) } catch (err) { setError(apiErrorText(err, lang)) } finally { setBusy(false) }
  }
  const decide = async (reason: string) => {
    if (action === 'reject') { await api.reject(open.id, reason); done(t('rev.rejected', { name })) } else { await api.release(open.id, reason); done(t('rev.released', { name })) }
  }

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>{representative && <Button variant="ghost" className="text-red-800" disabled={busy} onClick={() => setAction('release')}><Icon name="x" className="h-4 w-4" />{t('rev.release')}</Button>}</div>
      <div className="flex flex-wrap gap-2">
        {pending && <Button variant="danger" disabled={busy} onClick={() => setAction('reject')}>{t('admin.centers.reject')}</Button>}
        {pending && <Button disabled={busy} onClick={() => void approve()}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('admin.centers.approve')}</Button>}
      </div>
    </div>
  )

  return (
    <>
      {/* Hidden while the reason dialog is open, so Esc there does not close the card as well. */}
      {!action && <Modal open onClose={onClose} wide title={name || t('common.loading')} footer={inst || comp ? footer : undefined}>
        {error && <p className="mb-3 text-sm text-red-700" role="alert">{error}</p>}
        {!inst && !comp && !error && <p className="text-sm text-charcoal/55">{t('common.loading')}</p>}
        {status && <div className="mb-3 flex flex-wrap items-center gap-2"><Badge tone={status === 'APPROVED' ? 'forest' : status === 'REJECTED' ? 'danger' : status === 'PENDING' ? 'champagne' : 'muted'}>{t(`rev.status.${status}`)}</Badge>{!pending && <span className="text-xs text-charcoal/55">{t('rev.notPendingNote')}</span>}</div>}
        {inst && <InstitutionFacts review={inst} />}
        {comp && <CompanyFacts review={comp} />}
        {(inst || comp) && !representative && <Notice tone="info" className="mt-4 text-xs">{t('rev.noRepresentative')}</Notice>}
        <HistoryList items={inst?.history ?? comp?.history ?? []} />
      </Modal>}
      {action && <ReasonDialog action={action} name={name} kind={open.kind} onClose={closeAction} onSubmit={decide} />}
    </>
  )
}

function InstitutionFacts({ review }: { review: InstitutionReviewDto }) {
  const { t, tr, lang } = useT()
  const p = review.passport
  const rep = review.representative
  return (
    <>
      {review.officialName ? <OfficialName entered={p.name} official={review.officialName} large /> : <Notice tone="warn" className="text-xs">{t('rev.notInRegistryLong')}</Notice>}
      <dl className="mt-4">
        <Fact label={t('rev.enteredName')}>{p.name}</Fact>
        <Fact label={t('rev.officialName')}>{review.officialName}</Fact>
        <Fact label={t('rev.nameRu')}>{p.nameRu}</Fact>
        <Fact label={t('rev.formerName')}>{p.formerName}</Fact>
        <Fact label={t('rev.type')}>{t(`inst.type.${p.type}`)}</Fact>
        <Fact label={t('auth.org.ownershipLabel')}>{p.ownership ? t(p.ownership === 'STATE' ? 'auth.org.stateInst' : 'auth.org.privateInst') : null}</Fact>
        <Fact label={t('auth.org.stir')}>{p.stir}</Fact>
        <Fact label={t('rev.place')}>{[tr(p.region?.name), p.district ? tr(p.district.name) : p.districtName].filter(Boolean).join(', ')}</Fact>
        <Fact label={t('center.address')}>{p.address}</Fact>
        <Fact label={t('center.phone')}>{p.phone}</Fact>
        <Fact label={t('q.email')}>{p.email}</Fact>
        <Fact label={t('rev.website')}>{p.website}</Fact>
        <Fact label={t('rev.director')}>{p.directorName}</Fact>
        <Fact label={t('rev.representative')}>{rep ? [rep.name, rep.jobTitle, rep.login ? `@${rep.login}` : null].filter(Boolean).join(' · ') : null}</Fact>
        <Fact label={t('rev.submitted')}>{p.submittedAt ? when(p.submittedAt, lang) : null}</Fact>
        <Fact label={t('rev.approvedBefore')}>{p.approvedAt ? formatDate(p.approvedAt, lang) : null}</Fact>
        <Fact label={t('rev.lastRejectReason')}>{p.rejectReason}</Fact>
      </dl>
      {p.directions.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-2 font-body text-xs font-semibold uppercase tracking-wider text-charcoal/50">{t('rev.directions')} · {p.totals.directions} · {t('rev.students')}: {p.totals.students}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-xs text-charcoal/50"><tr><th className="py-1.5 pr-3 font-medium">{t('q.direction')}</th><th className="py-1.5 pr-3 font-medium">{t('dir.industry')}</th><th className="py-1.5 pr-3 font-medium">{t('rev.department')}</th><th className="py-1.5 text-right font-medium">{t('rev.students')}</th></tr></thead>
              <tbody>
                {p.directions.map((d) => (
                  <tr key={d.id} className="border-t border-charcoal/8">
                    <td className="py-1.5 pr-3">{d.direction.name}{d.direction.official && <span className="ml-1.5 text-[11px] text-forest">{t('dir.official')}{d.direction.code ? ` · ${d.direction.code}` : ''}</span>}</td>
                    <td className="py-1.5 pr-3 text-charcoal/70">{tr(d.direction.industry.name)}</td>
                    <td className="py-1.5 pr-3 text-charcoal/70">{d.department ?? '—'}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.studentsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

function CompanyFacts({ review }: { review: CompanyReviewDto }) {
  const { t, tr, lang } = useT()
  const p = review.profile
  const rep = review.representative
  const [link, setLink] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const certificate = async () => {
    setLinkError(null)
    try { setLink((await reviews.companies.certificate(p.id)).url) } catch (err) { setLinkError(apiErrorText(err, lang)) }
  }
  return (
    <>
      <dl>
        <Fact label={t('rev.enteredName')}>{p.name}</Fact>
        <Fact label={t('auth.org.stir')}>{p.stir}</Fact>
        <Fact label={t('rev.place')}>{[tr(p.region?.name), p.district ? tr(p.district.name) : null].filter(Boolean).join(', ')}</Fact>
        <Fact label={t('center.address')}>{p.address}</Fact>
        <Fact label={t('rev.website')}>{p.website}</Fact>
        <Fact label={t('rev.industries')}>{p.industries.map((x) => tr(x.name)).join(', ')}</Fact>
        <Fact label={t('rev.directions')}>{p.directions.map((x) => x.name).join(', ')}</Fact>
        <Fact label={t('common.description')}>{p.about}</Fact>
        <Fact label={t('rev.representative')}>{rep ? [rep.name, rep.jobTitle, rep.email, rep.login ? `@${rep.login}` : null].filter(Boolean).join(' · ') : null}</Fact>
        <Fact label={t('rev.submitted')}>{p.submittedAt ? when(p.submittedAt, lang) : null}</Fact>
        <Fact label={t('rev.approvedBefore')}>{p.approvedAt ? formatDate(p.approvedAt, lang) : null}</Fact>
        <Fact label={t('rev.lastRejectReason')}>{p.rejectReason}</Fact>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {p.certificateUploaded
          ? (link
            ? <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-forest underline"><Icon name="external" className="h-4 w-4" />{t('rev.certificateOpen')}</a>
            : <Button size="sm" variant="secondary" onClick={() => void certificate()}><Icon name="file" className="h-3.5 w-3.5" />{t('rev.certificateLink')}</Button>)
          : <Badge tone="warn">{t('rev.certificateNo')}</Badge>}
        {link && <span className="text-[11px] text-charcoal/50">{t('rev.certificateExpires')}</span>}
        {linkError && <span className="text-xs text-red-700" role="alert">{linkError}</span>}
      </div>
    </>
  )
}

/** The reason for a rejection or for unlinking the representative; the representative sees it. API errors stay here. */
function ReasonDialog({ action, name, kind, onClose, onSubmit }: { action: Action; name: string; kind: Kind; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const { t, lang } = useT()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = reasonOk(reason)
  const go = async () => {
    if (!ok) return
    setBusy(true); setError(null)
    try { await onSubmit(reason) } catch (err) { setError(apiErrorText(err, lang)); setBusy(false) }
  }
  const release = action === 'release'
  return (
    <Modal
      open
      onClose={onClose}
      title={t(release ? 'rev.release' : 'admin.centers.reject')}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="danger" disabled={!ok || busy} onClick={() => void go()}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : null}{t(release ? 'rev.release' : 'admin.centers.reject')}</Button></div>}
    >
      <div className="space-y-3">
        <p className="text-sm font-medium text-charcoal">«{name}»</p>
        <p className="text-sm leading-relaxed text-charcoal/75">{t(release ? (kind === 'companies' ? 'rev.releaseBodyCompany' : 'rev.releaseBody') : 'rev.rejectBody')}</p>
        <label className="block text-sm font-medium text-charcoal" htmlFor="review-reason">{t('rev.reason')} <span className="text-red-700">*</span></label>
        <Textarea id="review-reason" rows={4} maxLength={REASON_MAX} value={reason} onChange={(e) => { setReason(e.target.value); setError(null) }} placeholder={t(release ? 'rev.releasePlaceholder' : 'rev.rejectPlaceholder')} />
        <p className="text-[11px] text-charcoal/50">{t('rev.reasonHint', { min: REASON_MIN })}</p>
        {reason.trim() && /[<>]/.test(reason) && <p className="text-xs text-red-700">{t('rev.reasonMarkup')}</p>}
        {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
