import { Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { useStore } from '../../store/useStore'
import { FaqList } from './TemplatePages'

export function FaqPage() {
  const { t } = useT()
  const enabled = useStore((s) => s.site.features.faq)
  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle eyebrow="FAQ" title={t('faq.title')} />
      {enabled ? <div className="max-w-3xl"><FaqList /></div> : <Notice tone="warn">{t('common.disabled')}</Notice>}
    </div>
  )
}
