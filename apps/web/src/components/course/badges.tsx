import { useT } from '../../i18n/useT'
import type { Status, Visibility } from '../../types'
import { Badge, Icon } from '../ui'

export function StatusBadge({ status }: { status: Status }) {
  const { t } = useT()
  const tone = status === 'published' ? 'sage' : status === 'draft' ? 'warn' : 'muted'
  return <Badge tone={tone}>{t(`status.${status}`)}</Badge>
}

export function VisibilityBadge({ visibility }: { visibility: Visibility | null | undefined }) {
  const { t } = useT()
  if (!visibility) return <Badge tone="danger"><Icon name="warn" className="h-3 w-3" />{t('vis.unset')}</Badge>
  return visibility === 'public' ? (
    <Badge tone="neutral"><Icon name="globe" className="h-3 w-3" />{t('vis.public')}</Badge>
  ) : (
    <Badge tone="champagne"><Icon name="lock" className="h-3 w-3" />{t('vis.private')}</Badge>
  )
}

export function AccessBadge({ reason }: { reason: 'public' | 'owner' | 'admin' | 'assigned-student' | 'assigned-group' }) {
  const { t } = useT()
  if (reason === 'public') return null
  if (reason === 'owner') return <Badge tone="sage">{t('access.ownerBadge')}</Badge>
  if (reason === 'admin') return <Badge tone="muted">{t('access.adminBadge')}</Badge>
  return <Badge tone="champagne"><Icon name="lock" className="h-3 w-3" />{t('access.privateBadge')}</Badge>
}

export function LevelBadge({ level }: { level: 'beginner' | 'intermediate' | 'advanced' }) {
  const { t } = useT()
  return <Badge tone="muted">{t(`level.${level}`)}</Badge>
}
