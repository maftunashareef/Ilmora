'use client'
import type { CompanyCardDto, PartyContactsDto } from '@ilmora/shared'
import { Badge, Card, EmptyState, Icon, LinkButton } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { usePassport } from './passportStore'

/** Students, requests and graduation open once the Super Admin approved the profile (the API answers 403 `not_approved` before). */
export function ClosedNotice() {
  const { t } = useT()
  // A blocked institution is closed whatever its review status: filling the passport in would not open anything.
  const { passport } = usePassport()
  if (passport?.blocked) return <EmptyState icon={<Icon name="lock" className="h-6 w-6" />} title={t('org.blocked')} />
  return (
    <EmptyState
      icon={<Icon name="lock" className="h-6 w-6" />}
      title={t('inst.closed')}
      body={t('inst.closedBody')}
      action={<LinkButton to="/institution">{t('inst.openPassport')}</LinkButton>}
    />
  )
}

/** A company on a request or a response: name, region, industries, about — contacts only once accepted. */
export function CompanyLine({ company }: { company: CompanyCardDto }) {
  const { tr } = useT()
  return (
    <div>
      <div className="font-medium text-charcoal">{company.name}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-charcoal/60">
        {company.region && <span><Icon name="pin" className="mr-0.5 inline h-3 w-3" />{tr(company.region.name)}</span>}
        {company.industries.map((i) => <Badge key={i.id} tone="sage">{tr(i.name)}</Badge>)}
      </div>
      {company.about && <p className="mt-1.5 text-sm text-charcoal/70">{company.about}</p>}
    </div>
  )
}

/** The other side's contacts, shown once an offer or a response is accepted. */
export function Contacts({ contacts, title }: { contacts: PartyContactsDto; title: string }) {
  const { t } = useT()
  const rows: [string, string | null][] = [
    [t('inst.c.phone'), contacts.phone], [t('inst.p.email'), contacts.email], [t('rev.website'), contacts.website], [t('min.inst.address'), contacts.address],
    [t('inst.c.representative'), contacts.representative ? [contacts.representative.name, contacts.representative.jobTitle, contacts.representative.email].filter(Boolean).join(' · ') : null],
  ]
  return (
    <Card className="mt-3 bg-sage/20 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-forest"><Icon name="check" className="h-3.5 w-3.5" />{title}</div>
      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt className="text-xs text-charcoal/50">{k}</dt><dd className="break-words text-charcoal">{v}</dd></div>
        ))}
      </dl>
    </Card>
  )
}
