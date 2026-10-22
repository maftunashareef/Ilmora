'use client'
import { useEffect, type ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { useLocation, useNavigate } from '@/lib/router'
import { useStore } from '@/store/useStore'
import type { Role } from '@/types'
import { ConsentGate, needsConsent } from './ConsentGate'
import { Card, Icon, LinkButton } from './ui'

/**
 * Gate for private workspaces. Waits for the session bootstrap, sends anonymous visitors to the sign-in
 * page (returning afterwards) and shows a clear message to signed-in users without the required role.
 */
export function RequireRole({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const { t } = useT()
  const status = useStore((s) => s.auth.status)
  const current = useStore((s) => s.role)
  const roles = useStore((s) => s.auth.user?.roles ?? [])
  const user = useStore((s) => s.auth.user)
  const ensureWorkspace = useStore((s) => s.ensureWorkspace)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const wanted = Array.isArray(role) ? role : [role]
  const allowed = wanted.includes(current) || roles.includes('PLATFORM_ADMIN') || (wanted.includes('teacher') && roles.includes('TEACHER')) || (wanted.includes('student') && roles.includes('STUDENT'))

  useEffect(() => {
    if (status === 'anonymous') navigate(`/login?next=${encodeURIComponent(pathname)}`, { replace: true })
  }, [status, navigate, pathname])
  useEffect(() => {
    if (status === 'authenticated' && allowed && (wanted.includes('teacher') || wanted.includes('admin'))) void ensureWorkspace()
  }, [status, allowed, ensureWorkspace, wanted])

  if (status === 'idle' || status === 'loading' || status === 'anonymous') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-charcoal/55" role="status" aria-live="polite">
        <Icon name="refresh" className="mr-2 h-4 w-4 animate-spin" /> {t('auth.checking')}
      </div>
    )
  }
  if (!allowed) {
    return (
      <div className="container-x py-16">
        <Card className="mx-auto max-w-lg px-8 py-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-900"><Icon name="lock" className="h-5 w-5" /></div>
          <h1 className="font-display text-3xl text-charcoal">{t('auth.noAccess')}</h1>
          <p className="mt-3 text-sm text-charcoal/65">{t('auth.noAccessBody')}</p>
          <div className="mt-6 flex justify-center gap-2"><LinkButton to="/">{t('common.goHome')}</LinkButton></div>
        </Card>
      </div>
    )
  }
  // Every account confirms the current offer edition and personal-data consent before using a workspace.
  if (needsConsent(user)) return <ConsentGate />
  return <>{children}</>
}
