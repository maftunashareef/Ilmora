'use client'
import { useState } from 'react'
import type { InstitutionCardDto, StudentFullCardDto } from '@ilmora/shared'
import { Button, EmptyState, Icon, LinkButton } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import type { DocumentLinkDto } from '@ilmora/shared'
import { useStore } from '../../store/useStore'
import { useCompany } from './companyStore'

/** Graduates, requests, vacancies, contract help and contacts open once the Super Admin approved the profile (403 `not_approved` before). */
export function CompanyClosed() {
  const { t } = useT()
  // A blocked company is closed whatever its review status: filling the profile in would not open anything.
  const { profile } = useCompany()
  if (profile?.blocked) return <EmptyState icon={<Icon name="lock" className="h-6 w-6" />} title={t('org.blocked')} />
  return <EmptyState icon={<Icon name="lock" className="h-6 w-6" />} title={t('inst.closed')} body={t('co.closedBody')} action={<LinkButton to="/company">{t('co.openProfile')}</LinkButton>} />
}

/** An institution on an offer or an announcement: name, type, region. */
export function InstitutionLine({ institution }: { institution: InstitutionCardDto }) {
  const { t, tr } = useT()
  return (
    <div>
      <div className="font-medium text-charcoal">{institution.name}</div>
      <div className="mt-0.5 text-xs text-charcoal/60">
        {t(`inst.type.${institution.type}`)}{institution.region && <> · <Icon name="pin" className="mr-0.5 inline h-3 w-3" />{tr(institution.region.name)}</>}
      </div>
    </div>
  )
}

/**
 * A student's full card (ТЗ 5.3, 9.4): only once the student shared it — an accepted contact request or an
 * application to a vacancy. Certificate files open through 5-minute links, one at a time.
 */
export function StudentCard({ card, openFile }: { card: StudentFullCardDto; openFile: (certificateId: string) => Promise<DocumentLinkDto> }) {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [busy, setBusy] = useState<string | null>(null)
  const open = async (certId: string) => {
    setBusy(certId)
    try { const link = await openFile(certId); window.open(link.url, '_blank', 'noopener,noreferrer') } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }
  const rows: [string, string | null][] = [
    [t('inst.c.phone'), card.phone], [t('inst.p.email'), card.email], [t('co.s.institution'), card.institution],
    [t('inst.p.direction'), card.direction ? `${card.direction.name} · ${tr(card.direction.industry.name)}` : null],
    [t('inst.g.year'), card.graduationYear != null ? String(card.graduationYear) : null],
  ]
  return (
    <div className="mt-3 rounded-control border border-forest/20 bg-sage/20 p-4">
      <div className="font-medium text-charcoal">{card.name}</div>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-xs text-charcoal/50">{k}</dt><dd className="break-words text-charcoal">{v}</dd></div>)}
      </dl>
      {card.about && <p className="mt-2 text-sm text-charcoal/75"><span className="text-xs text-charcoal/50">{t('co.s.about')}:</span> {card.about}</p>}
      {card.certificates.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-charcoal/50">{t('co.s.certificates')}</div>
          <ul className="mt-1 space-y-1">
            {card.certificates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{c.title}{c.issuer && <span className="text-charcoal/55"> · {c.issuer}</span>}</span>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void open(c.id)}><Icon name="external" className="h-3.5 w-3.5" />{t('co.s.openFile')}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
