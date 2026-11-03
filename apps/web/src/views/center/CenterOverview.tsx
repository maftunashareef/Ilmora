'use client'
import { useEffect, useState } from 'react'
import { QrCode } from '../../components/QrCode'
import { Badge, Card, EmptyState, Eyebrow, Icon, LinkButton, Notice, PageTitle, Stat } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api } from '../../lib/api'
import { formatTime } from '../../lib/format'
import { Link } from '../../lib/router'
import { useStore } from '../../store/useStore'
import { useCenterScope, type CenterOverview as Overview, type CenterQr } from './centerApi'

export function CenterStatusNotice({ status }: { status: Overview['center']['status'] }) {
  const { t } = useT()
  if (status === 'PENDING') return <Notice tone="warn" className="mb-6">{t('center.pendingNotice')}</Notice>
  if (status === 'BLOCKED') return <Notice tone="warn" className="mb-6">{t('center.blockedNotice')}</Notice>
  return null
}

export function CenterOverview() {
  const { t, tr, lang } = useT()
  const user = useStore((s) => s.auth.user)
  const scope = useCenterScope()
  const linked = scope.admin || (!!user?.roles.includes('CENTER_ADMIN') && !!user.centerId)
  const [data, setData] = useState<Overview | null>(null)
  const [qr, setQr] = useState<CenterQr | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!linked) return
    let live = true
    api<Overview>(`${scope.base}/overview`).then((d) => live && setData(d)).catch(() => live && setFailed(true))
    api<CenterQr>(`${scope.base}/qr`).then((q) => live && setQr(q)).catch(() => undefined)
    return () => { live = false }
  }, [linked, scope.base])

  if (!linked) return <EmptyState icon={<Icon name="building" className="h-5 w-5" />} title={t('center.noCenter')} body={t('center.noCenterHint')} />
  if (failed) return <Notice tone="warn">{t('center.loadError')}</Notice>
  if (!data) return <div className="py-16 text-center text-sm text-charcoal/55">{t('common.loading')}</div>
  const c = data.center

  return (
    <div>
      <PageTitle eyebrow={t('dash.center')} title={c.name} subtitle={tr(c.district)} action={<Badge tone={c.status === 'ACTIVE' ? 'forest' : c.status === 'PENDING' ? 'champagne' : 'danger'}>{t(`center.status.${c.status}`)}</Badge>} />
      <CenterStatusNotice status={c.status} />
      <div className="reveal-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('center.teachers')} value={data.counts.teachers} />
        <Stat label={t('center.courses')} value={data.counts.courses} hint={`${data.counts.groups} ${t('common.groups').toLowerCase()}`} />
        <Stat label={t('center.students')} value={data.counts.students} />
        <Stat label={t('center.todayLessons')} value={data.today.length} />
      </div>
      <div className="mt-10 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <div className="mb-3 flex items-center justify-between"><Eyebrow>{t('center.todayLessons')}</Eyebrow><Link to={scope.links('attendance')} className="text-xs font-medium text-forest underline">{t('center.attendance')}</Link></div>
          {data.today.length === 0 ? <EmptyState title={t('center.noLessonsToday')} /> : (
            <ul className="space-y-2">
              {data.today.map((l) => (
                <li key={l.session.id} className="card flex items-center gap-4 p-3">
                  <div className="w-16 shrink-0 text-center"><div className="font-display text-xl text-charcoal">{formatTime(l.session.startsAt ?? `${l.session.date}T${l.session.start}:00`, lang)}</div></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-charcoal">{tr(l.courseTitle)} · {l.group.name}</div>
                    <div className="text-xs text-charcoal/55">{l.teacherName} · {t('common.room')} {l.group.room} · {t('center.lessonCounts', { present: l.present, absent: l.absent, roster: l.roster })}</div>
                  </div>
                  {l.session.status === 'cancelled' ? <Badge tone="danger">{t('session.status.cancelled')}</Badge> : l.session.attendanceOpen ? <Badge tone="forest">{t('session.isOpen')}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <Eyebrow className="mb-3">{t('center.qrTitle')}</Eyebrow>
          <Card className="flex flex-col items-center gap-3 p-6 text-center">
            {qr ? <QrCode value={qr.url} size={200} label={t('center.qrTitle')} /> : <div className="h-[200px] w-[200px] animate-pulse rounded-card bg-sage/60" />}
            <p className="text-xs leading-relaxed text-charcoal/60">{t('center.qrHint')}</p>
            <LinkButton to={scope.links('settings')} variant="secondary" size="sm"><Icon name="settings" className="h-3.5 w-3.5" />{t('center.settings')}</LinkButton>
          </Card>
        </section>
      </div>
    </div>
  )
}
