'use client'
import { useEffect, useRef, useState } from 'react'
import { Card, Eyebrow, Icon, Notice } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { useNavigate, useSearchParams } from '../../lib/router'
import { canOpen, homeFor } from '../../lib/workspaceHome'
import { useStore } from '../../store/useStore'

export function GoogleCallbackPage() {
  const { t } = useT()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const loginWithGoogle = useStore((s) => s.loginWithGoogle)
  const notify = useStore((s) => s.notify)
  const setLang = useStore((s) => s.setLang)
  const lang = useStore((s) => s.lang)

  const [error, setError] = useState<string | null>(null)
  const codeExchanged = useRef(false)

  const code = params.get('code')
  const oauthError = params.get('error')
  const oauthErrorDesc = params.get('error_description')
  const rawState = params.get('state') ?? ''

  let stateLang: 'uz' | 'ru' | 'en' | undefined
  let stateRole: 'STUDENT' | 'TEACHER' | undefined
  let stateNext: string | null = null

  if (rawState) {
    try {
      const decoded = decodeURIComponent(rawState)
      const parsed = JSON.parse(decoded)
      if (parsed && typeof parsed === 'object') {
        if (parsed.lang && ['uz', 'ru', 'en'].includes(parsed.lang)) stateLang = parsed.lang
        if (parsed.role && ['STUDENT', 'TEACHER'].includes(parsed.role)) stateRole = parsed.role
        if (typeof parsed.next === 'string' && parsed.next.startsWith('/') && !parsed.next.startsWith('//')) {
          stateNext = parsed.next
        }
      }
    } catch {
      if (rawState.startsWith('/') && !rawState.startsWith('//')) {
        stateNext = rawState
      }
    }
  }

  const nextParam = params.get('next')
  const safeNext = (nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')) ? nextParam : stateNext

  useEffect(() => {
    if (stateLang && stateLang !== lang) {
      setLang(stateLang)
    }

    if (codeExchanged.current) return

    if (oauthError) {
      codeExchanged.current = true
      let msg = t('auth.err.google')
      if (oauthError === 'access_denied' || oauthError === 'user_cancelled_authorize') {
        msg = t('auth.err.googleCancelled')
      } else if (oauthErrorDesc) {
        msg = oauthErrorDesc
      }
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
        const user = await loginWithGoogle({
          code,
          redirectUri,
          role: stateRole,
          lang: stateLang || lang,
        })
        if (user.preferredLang && ['uz', 'ru', 'en'].includes(user.preferredLang)) {
          setLang(user.preferredLang)
        }
        notify(t('auth.welcome', { name: user.displayName }))
        const roles = user.roles ?? []
        nav(safeNext && canOpen(roles, safeNext) ? safeNext : homeFor(roles), { replace: true })
      } catch (err) {
        let msg = t('auth.err.google')
        if (isApiError(err)) {
          if (err.code === 'google_unconfigured') msg = t('auth.err.googleUnconfigured')
          else if (err.code === 'account_disabled') msg = t('auth.err.disabled')
          else if (err.code === 'unverified_email') msg = t('auth.err.google')
          else msg = apiErrorText(err, lang)
        }
        setError(msg)
        notify(msg, 'warn')
        setTimeout(() => nav('/login', { replace: true }), 3000)
      }
    }

    void exchange()
  }, [code, oauthError, oauthErrorDesc, loginWithGoogle, nav, notify, safeNext, stateLang, stateRole, lang, setLang, t])

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
              <h1 className="font-display text-2xl text-charcoal">{t('auth.google')}</h1>
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
