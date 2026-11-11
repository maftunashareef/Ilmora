'use client'
import { DashboardShell } from '../../components/layout/DashboardShell'
import { useT } from '../../i18n/useT'

/** The company's workspace (ТЗ 4.3, 5.1–5.4): profile, training requests, graduates, vacancies, contract help, contacts. */
export function CompanyLayout() {
  const { t } = useT()
  return (
    <DashboardShell role="company" title={t('dash.company')} subtitle={t('co.subtitle')} items={[
      { id: 'profile', to: '/company', end: true, label: t('co.nav.profile'), icon: 'building' },
      { id: 'requests', to: '/company/requests', label: t('co.nav.requests'), icon: 'cap' },
      { id: 'graduates', to: '/company/graduates', label: t('co.nav.graduates'), icon: 'users' },
      { id: 'students', to: '/company/students', label: t('co.nav.students'), icon: 'cap' },
      { id: 'vacancies', to: '/company/vacancies', label: t('co.nav.vacancies'), icon: 'briefcase' },
      { id: 'contract-help', to: '/company/contract-help', label: t('co.nav.contractHelp'), icon: 'shield' },
      { id: 'contacts', to: '/company/contacts', label: t('co.nav.contacts'), icon: 'user' },
    ]} />
  )
}
