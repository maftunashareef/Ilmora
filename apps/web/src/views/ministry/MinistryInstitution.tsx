'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { formatDate, type InstitutionPassportDto } from '@ilmora/shared'
import { Badge, Card, EmptyState, Icon, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { Link } from '../../lib/router'
import { useParams } from '../../lib/routerHooks'
import { formatCount, ministry } from '../../services/ministry'
import { StatusBadge } from './common'

/** An institution's card for the ministry (`GET /ministry/institutions/:id`): the profile, its fields of study and students. Read-only. */
export function MinistryInstitution() {
  const { t, tr, lang } = useT()
  const { id = '' } = useParams<{ id: string }>()
  // The answer for one id: another id (the address changed) shows «loading» until its own answer comes.
  const [answer, setAnswer] = useState<{ id: string; inst?: InstitutionPassportDto; error?: unknown } | null>(null)
  const inst = answer?.id === id ? answer.inst ?? null : null
  const error = answer?.id === id ? answer.error ?? null : null

  useEffect(() => {
    let live = true
    ministry.institution(id).then((r) => { if (live) setAnswer({ id, inst: r }) }, (e) => { if (live) setAnswer({ id, error: e ?? 'error' }) })
    return () => { live = false }
  }, [id])

  const back = (
    <Link to="/ministry/institutions" className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal/60 hover:text-forest">
      <Icon name="arrowLeft" className="h-4 w-4" />{t('min.inst.back')}
    </Link>
  )
  if (error != null) {
    return <div>{back}{isApiError(error) && error.status === 404 ? <EmptyState icon={<Icon name="search" className="h-6 w-6" />} title={t('min.inst.notFound')} /> : <Notice tone="warn">{apiErrorText(error, lang)}</Notice>}</div>
  }
  if (!inst) return <div>{back}<p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p></div>

  const place = [inst.region ? tr(inst.region.name) : null, inst.district ? tr(inst.district.name) : inst.districtName].filter(Boolean).join(', ')
  return (
    <div>
      {back}
      <PageTitle
        eyebrow={t('min.inst.passport')}
        title={inst.name}
        subtitle={[inst.nameRu && inst.nameRu !== inst.name ? inst.nameRu : null, inst.formerName ? t('auth.org.formerName', { name: inst.formerName }) : null].filter(Boolean).join(' · ') || undefined}
        action={<div className="flex flex-wrap gap-1.5"><StatusBadge status={inst.status} />{inst.blocked && <Badge tone="danger"><Icon name="lock" className="h-3 w-3" />{t('rev.blocked')}</Badge>}</div>}
      />
      {inst.pendingChanges && <Notice className="mb-5">{t('min.inst.pendingChanges')}</Notice>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 border-b border-charcoal/10 px-5 py-3.5">
            <h2 className="font-display text-lg text-charcoal">{t('rev.directions')}</h2>
            <span className="text-xs text-charcoal/55">{t('min.inst.totals', { students: formatCount(inst.totals.students, lang), directions: formatCount(inst.totals.directions, lang) })}</span>
          </div>
          {inst.directions.length === 0 ? <p className="px-5 py-6 text-sm text-charcoal/55">{t('min.inst.noDirections')}</p> : (
            <div className="overflow-x-auto">
              <table className="table-cards w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="bg-sage/30 text-left text-xs text-charcoal/60">
                    <th scope="col" className="px-4 py-2.5 font-medium">{t('min.inst.direction')}</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">{t('min.filter.industry')}</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">{t('rev.department')}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('rev.students')}</th>
                  </tr>
                </thead>
                <tbody>
                  {inst.directions.map((d) => (
                    <tr key={d.id} className="border-t border-charcoal/8">
                      <th scope="row" className="px-4 py-2 text-left font-medium text-charcoal">{d.direction.name}</th>
                      <td className="px-4 py-2 text-charcoal/75">{tr(d.direction.industry.name)}</td>
                      <td className="px-4 py-2 text-charcoal/75">{d.department ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-charcoal/80">{formatCount(d.studentsCount, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <dl className="space-y-3 text-sm">
            <Row label={t('rev.type')}>{t(`inst.type.${inst.type}`)}</Row>
            <Row label={t('min.inst.ownership')}>{inst.ownership ? t(`min.own.${inst.ownership}`) : '—'}</Row>
            <Row label={t('auth.org.stir')}>{inst.stir ?? '—'}</Row>
            <Row label={t('rev.place')}>{place || '—'}</Row>
            <Row label={t('min.inst.address')}>{inst.address ?? '—'}</Row>
            <Row label={t('rev.director')}>{inst.directorName ?? '—'}</Row>
            <Row label={t('min.inst.contacts')}>
              {[inst.phone, inst.email].filter(Boolean).join(' · ') || '—'}
              {inst.website && <a href={/^https?:\/\//.test(inst.website) ? inst.website : `https://${inst.website}`} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-forest hover:underline">{inst.website}</a>}
            </Row>
            {inst.approvedAt && <Row label={t('min.inst.approvedAt')}>{formatDate(inst.approvedAt, lang)}</Row>}
          </dl>
        </Card>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-charcoal/50">{label}</dt>
      <dd className="mt-0.5 break-words text-charcoal">{children}</dd>
    </div>
  )
}
