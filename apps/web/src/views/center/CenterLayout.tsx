'use client'
import { DashboardShell } from '../../components/layout/DashboardShell'
import { useT } from '../../i18n/useT'

/** Workspace of a center administrator: their own center's courses and discounts, nothing of the Teacher Studio. */
export function CenterLayout() {
  const { t } = useT()
  return <DashboardShell role="center" title={t('dash.center')} subtitle={t('center.subtitle')} items={[{ id: 'courses', to: '/center', end: true, label: t('center.courses'), icon: 'book' }]} />
}
