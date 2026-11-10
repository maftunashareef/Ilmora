'use client'
import { Icon, LinkButton } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { useQuestionnaire } from '../../services/questionnaire'

/** For students without a complete questionnaire (older accounts too, ТЗ 4.1): nothing is blocked, this only invites them. */
export function QuestionnaireBanner() {
  const { t } = useT()
  const { data, status } = useQuestionnaire()
  if (status !== 'ready' || !data || data.complete) return null
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-card border border-champagne/60 bg-champagne/15 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5" role="region" aria-label={t('q.banner.title')}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-champagne/40 text-forest"><Icon name="edit" className="h-4 w-4" /></span>
        <div>
          <p className="text-sm font-semibold text-charcoal">{t('q.banner.title')}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-charcoal/70">{t('q.banner.body')}</p>
        </div>
      </div>
      <LinkButton to="/student/questionnaire" size="sm" className="shrink-0">{t('q.banner.action')} <Icon name="arrowRight" className="h-3.5 w-3.5" /></LinkButton>
    </div>
  )
}
