'use client'
import { DashboardShell } from '../../components/layout/DashboardShell'
import { useT } from '../../i18n/useT'

/** The ministry's workspace (ТЗ 7): the figures with filters and Excel, the registry of institutions and of companies. Read-only. */
export function MinistryLayout() {
  const { t } = useT()
  return (
    <DashboardShell role="ministry" title={t('dash.ministry')} subtitle={t('min.subtitle')} items={[
      { id: 'figures', to: '/ministry', end: true, label: t('min.nav.figures'), icon: 'chart' },
      { id: 'institutions', to: '/ministry/institutions', label: t('min.nav.institutions'), icon: 'cap' },
      { id: 'companies', to: '/ministry/companies', label: t('min.nav.companies'), icon: 'briefcase' },
    ]} />
  )
}
