'use client'
import { useEffect } from 'react'
import { useLocation, useNavigate } from '@/lib/routerHooks'
import { DashboardShell } from '../../components/layout/DashboardShell'
import { Button, Icon, Notice } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { useStore } from '../../store/useStore'

export function AdminLayout() {
  const { t } = useT()
  const roles = useStore((s) => s.auth.user?.roles ?? [])
  const finance = roles.includes('FINANCE_ADMIN') || roles.includes('PLATFORM_ADMIN')
  const platform = roles.includes('PLATFORM_ADMIN')
  // The current site settings did not load: edits are refused until the page is refreshed (useStore.patchSite).
  const siteLoadFailed = useStore((s) => s.siteLoadFailed)
  // A finance admin (without the Super Admin role) only gets the finance page of this workspace.
  const financeOnly = finance && !platform
  const { pathname } = useLocation()
  const nav = useNavigate()
  useEffect(() => {
    if (financeOnly && !pathname.startsWith('/admin/finance')) nav('/admin/finance', { replace: true })
  }, [financeOnly, pathname, nav])
  if (financeOnly) {
    return <DashboardShell role="admin" title={t('dash.admin')} subtitle={t('finance.title')} items={[{ id: 'finance', to: '/admin/finance', label: t('finance.title'), icon: 'package' }]} />
  }
  return (
    <DashboardShell role="admin" title={t('dash.admin')} subtitle={t('admin.overview.hello')}
      notice={platform && siteLoadFailed ? <Notice tone="warn"><span className="flex flex-wrap items-center justify-between gap-3">{t('admin.siteNotLoaded')}<Button size="sm" variant="secondary" onClick={() => window.location.reload()}><Icon name="refresh" className="h-3.5 w-3.5" />{t('common.refresh')}</Button></span></Notice> : undefined}
      items={[
      { id: 'overview', to: '/admin', end: true, label: t('dash.overview'), icon: 'grid' },
      { id: 'notifications', to: '/admin/notifications', label: t('notif.title'), icon: 'bell' },
      { id: 'pages', to: '/admin/pages', label: t('admin.pages'), icon: 'layers' },
      { id: 'theme', to: '/admin/theme', label: t('admin.theme'), icon: 'palette' },
      { id: 'features', to: '/admin/features', label: t('admin.features'), icon: 'settings' },
      { id: 'courses', to: '/admin/courses', label: t('admin.courses'), icon: 'book' },
      { id: 'content', to: '/admin/content', label: t('admin.content'), icon: 'video' },
      { id: 'people', to: '/admin/people', label: t('admin.people'), icon: 'users' },
      ...(platform ? [{ id: 'accounts', to: '/admin/accounts', label: t('admin.accounts'), icon: 'shield' }] : []),
      ...(platform ? [{ id: 'reviews', to: '/admin/reviews', label: t('rev.title'), icon: 'list' }] : []),
      ...(platform ? [{ id: 'ministry', to: '/admin/ministry', label: t('admin.ministry.menu'), icon: 'globe' }] : []),
      { id: 'centers', to: '/admin/centers', label: t('admin.centers'), icon: 'building' },
      ...(platform ? [{ id: 'inquiries', to: '/admin/inquiries', label: t('admin.inquiries'), icon: 'archive' }] : []),
      { id: 'packages', to: '/admin/packages', label: t('admin.packages'), icon: 'package' },
      ...(finance ? [{ id: 'finance', to: '/admin/finance', label: t('finance.title'), icon: 'package' }] : []),
      { id: 'permissions', to: '/admin/permissions', label: t('admin.permissions'), icon: 'shield' },
      { id: 'announcements', to: '/admin/announcements', label: t('admin.announcements'), icon: 'megaphone' },
    ]} />
  )
}
