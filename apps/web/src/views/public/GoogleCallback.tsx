'use client'
import { useEffect, useRef, useState } from 'react'
import { Card, Eyebrow, Icon, Notice } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { useNavigate, useSearchParams } from '../../lib/router'
import { useStore, type AuthUser } from '../../store/useStore'

type Role = AuthUser['roles'][number]

const workspaceOf = (path: string) =>
  path.startsWith('/admin') ? 'admin' : path.startsWith('/teacher') ? 'teacher' : path.startsWith('/student') ? 'student' : null

const canOpen = (roles: Role[], path: string) => {
  const w = workspaceOf(path)
  if (!w || roles.includes('PLATFORM_ADMIN')) return true
  return w === 'teacher' ? roles.includes('TEACHER') : w === 'student' ? roles.includes('STUDENT') : false
}

const homeFor = (roles: Role[]) =>
  roles.includes('PLATFORM_ADMIN') ? '/admin' : roles.includes('TEACHER') ? '/teacher' : '/student'

export function GoogleCallbackPage() {
  const { t } = useT()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const loginWithGoogle = useStore((s) => s.loginWithGoogle)
  const notify = useStore((s) => s.notify)

  const [error, setError] = useState<string | null>(null)
  const codeExchanged = useRef(false)

  const code = params.get('code')
  const oauthError = params.get('error')
  const oauthErrorDesc = params.get('error_description')
  const rawNext = params.get('next') ?? params.get('state') ?? ''
  const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null

  useEffect(() => {
    if (codeExchanged.current) return

    if (oauthError) {
      codeExchanged.current = true
      const msg = oauthErrorDesc || t('auth.err.google')
      setError(msg)
      notify(msg, 'warn')
      setTimeout(() => nav('/login', { replace: true }), 2500)
      return
    }

    if (!code) {
      codeExchanged.current = true
      const msg = t('auth.err.google')
      setError(msg)
      setTimeout(() => nav('/login', { replace: true }), 2500)
      return
    }

    codeExchanged.current = true
    const exchange = async () => {
      try {
        const redirectUri = `${window.location.origin}/auth/google/callback`
        const user = await loginWithGoogle({ code, redirectUri })
        notify(t('auth.welcome', { name: user.displayName }))
        const roles = user.roles ?? []
        nav(safeNext && canOpen(roles, safeNext) ? safeNext : homeFor(roles), { replace: true })
      } catch (err) {
        let msg = t('auth.err.google')
        if (isApiError(err)) {
          if (err.code === 'google_unconfigured') msg = t('auth.err.googleUnconfigured')
          else if (err.code === 'account_disabled') msg = t('auth.err.disabled')
          else if (err.message) msg = err.message
        }
        setError(msg)
        notify(msg, 'warn')
        setTimeout(() => nav('/login', { replace: true }), 3000)
      }
    }

    void exchange()
  }, [code, oauthError, oauthErrorDesc, loginWithGoogle, nav, notify, safeNext, t])

  return (
    <div className="container-x py-14 lg:py-20">
      <div className="mx-auto max-w-md">
        <Eyebrow className="mb-2">ILMORA</Eyebrow>
        <Card className="px-5 py-8 text-center shadow-card border-charcoal/10 bg-white">
          {error ? (
            <div className="space-y-4">
              <Icon name="x" className="mx-auto h-8 w-8 text-amber-700" />
              <h1 className="font-display text-2xl text-charcoal">{t('auth.title')}</h1>
              <Notice tone="warn" className="text-left">
                {error}
              </Notice>
              <p className="text-xs text-charcoal/60">
                {t('common.back')}...
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <Icon name="refresh" className="mx-auto h-8 w-8 animate-spin text-forest" />
              <h1 className="font-display text-2xl text-charcoal">Google Sign-In</h1>
              <p className="text-sm text-charcoal/70">
                {t('auth.welcome', { name: '' })}...
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
