import { Link } from '@/lib/router'
import { useT } from '../i18n/useT'
import type { AccessResult } from '../lib/access'
import { Icon, LinkButton } from './ui'

/** Clear access-denied state for drafts, archived and unassigned private content opened directly. */
export function AccessDenied({ result, backTo }: { result: Extract<AccessResult, { allowed: false }>; backTo?: { to: string; label: string } }) {
  const { t } = useT()
  const body = result.reason === 'draft' ? t('access.draftBody') : result.reason === 'archived' ? t('access.archivedBody') : t('access.deniedBody')
  return (
    <div className="container-x py-20">
      <div className="card mx-auto max-w-lg px-8 py-12 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-champagne/25 text-charcoal"><Icon name="lock" className="h-6 w-6" /></div>
        <div className="eyebrow mb-2">{t(`status.${result.reason === 'private' ? 'published' : result.reason}`)} · {result.reason === 'private' ? t('vis.private') : ''}</div>
        <h1 className="font-display text-3xl text-charcoal">{t('access.deniedTitle')}</h1>
        <p className="mt-3 text-sm leading-relaxed text-charcoal/65">{body}</p>
        <p className="mt-2 text-xs text-charcoal/45">{t('access.signInHint')}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {backTo && <LinkButton to={backTo.to} variant="secondary">{backTo.label}</LinkButton>}
          <LinkButton to="/">{t('common.goHome')}</LinkButton>
        </div>
        <p className="mt-8 text-[11px] leading-relaxed text-charcoal/40">{t('access.securityNote')}</p>
      </div>
    </div>
  )
}

export function NotFound() {
  const { t } = useT()
  return (
    <div className="container-x py-24 text-center">
      <div className="font-display text-7xl text-champagne">404</div>
      <h1 className="mt-3 font-display text-3xl text-charcoal">{t('common.notFound')}</h1>
      <p className="mt-2 text-sm text-charcoal/60">{t('common.notFoundBody')}</p>
      <Link to="/" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-forest">{t('common.goHome')} <Icon name="arrowRight" className="h-4 w-4" /></Link>
    </div>
  )
}
