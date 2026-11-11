'use client'
import { DashboardShell } from '../../components/layout/DashboardShell'
import { useT } from '../../i18n/useT'

/** The institution's workspace (ТЗ 4.2, 5.1, 5.2): the passport, students, companies' requests and graduation. */
export function InstitutionLayout() {
  const { t } = useT()
  return (
    <DashboardShell role="institution" title={t('dash.institution')} subtitle={t('inst.subtitle')} items={[
      { id: 'passport', to: '/institution', end: true, label: t('inst.nav.passport'), icon: 'building' },
      { id: 'students', to: '/institution/students', label: t('inst.nav.students'), icon: 'users' },
      { id: 'requests', to: '/institution/requests', label: t('inst.nav.requests'), icon: 'briefcase' },
      { id: 'graduates', to: '/institution/graduates', label: t('inst.nav.graduates'), icon: 'cap' },
      { id: 'vacancies', to: '/institution/vacancies', label: t('inst.nav.vacancies'), icon: 'list' },
    ]} />
  )
}
