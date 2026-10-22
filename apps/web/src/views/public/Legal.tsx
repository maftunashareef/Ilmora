'use client'
import { OFFER_STATUS, OFFER_TEXT, OFFER_VERSION, OPERATOR, pick, type LegalBlock } from '@ilmora/shared'
import { Card, Eyebrow, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { Link } from '../../lib/router'

const EDITION_LABEL = '21.10.2026'

function Blocks({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-charcoal/80">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h1':
            return <h1 key={i} className="font-display text-4xl leading-tight text-charcoal">{b.text}</h1>
          case 'lead':
            return <p key={i} className="text-lg text-charcoal/70">{b.text}</p>
          case 'h2':
            return <h2 key={i} className="pt-6 font-display text-2xl text-charcoal">{b.text}</h2>
          case 'clause':
            return <p key={i} className="pl-4">{b.text}</p>
          case 'li':
            return <p key={i} className="pl-8">{b.text}</p>
          case 'kv':
            return (
              <div key={i} className="grid gap-1 border-b border-charcoal/10 py-2 sm:grid-cols-[1fr_2fr]">
                <span className="text-charcoal/55">{b.label}</span>
                <span className="font-medium text-charcoal">{b.value}</span>
              </div>
            )
          default:
            return <p key={i}>{b.text}</p>
        }
      })}
    </div>
  )
}

/** Public offer: the owner's document, shown in the requested language when supplied, otherwise in Russian with a notice. */
export function OfferPage() {
  const { t, lang } = useT()
  const own = OFFER_TEXT[lang]
  const blocks = own ?? OFFER_TEXT.ru ?? []
  return (
    <div className="container-x py-12 lg:py-16">
      <div className="mx-auto max-w-3xl">
        <Eyebrow className="mb-3">{t('legal.offer')} · {t('legal.edition')} {OFFER_VERSION}</Eyebrow>
        {OFFER_STATUS === 'draft' && <Notice tone="warn" className="mb-4 text-xs">{t('legal.draftNotice', { date: EDITION_LABEL })}</Notice>}
        {!own && <Notice tone="info" className="mb-6 text-xs">{t('legal.ruOnly')}</Notice>}
        <Card className="px-6 py-8 sm:px-10">
          <Blocks blocks={blocks} />
        </Card>
        <p className="mt-6 text-xs text-charcoal/50">
          <Link to="/privacy" className="underline">{t('legal.privacy')}</Link> · <a className="underline" href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
        </p>
      </div>
    </div>
  )
}

/** Personal data: a factual summary of what the platform processes, then section 9 and appendix 1 of the offer. */
export function PrivacyPage() {
  const { t, lang } = useT()
  const all = OFFER_TEXT.ru ?? []
  const idx = (prefix: string) => all.findIndex((b) => b.t === 'h2' && b.text.startsWith(prefix))
  const s9 = idx('9.')
  const s10 = idx('10.')
  const a1 = idx('Приложение 1')
  const a2 = idx('Приложение 2')
  const blocks = [...(s9 >= 0 ? all.slice(s9, s10 > s9 ? s10 : undefined) : []), ...(a1 >= 0 ? all.slice(a1, a2 > a1 ? a2 : undefined) : [])]
  return (
    <div className="container-x py-12 lg:py-16">
      <div className="mx-auto max-w-3xl">
        <PageTitle eyebrow={`${t('legal.edition')} ${OFFER_VERSION}`} title={t('legal.privacy')} subtitle={t('legal.privacyIntro')} />
        <Notice tone="info" className="mb-6 text-xs">{t('legal.privacyHosting')}</Notice>
        <p className="mb-6 text-sm text-charcoal/70">
          {t('legal.privacyContact')}: <a className="underline" href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> · {OPERATOR.phone} · {pick(lang, OPERATOR.legalName)}
        </p>
        {OFFER_STATUS === 'draft' && <Notice tone="warn" className="mb-4 text-xs">{t('legal.draftNotice', { date: EDITION_LABEL })}</Notice>}
        {!OFFER_TEXT[lang] && <Notice tone="info" className="mb-6 text-xs">{t('legal.ruOnly')}</Notice>}
        <Card className="px-6 py-8 sm:px-10">
          <Blocks blocks={blocks} />
        </Card>
        <p className="mt-6 text-xs text-charcoal/50"><Link to="/oferta" className="underline">{t('legal.offer')}</Link></p>
      </div>
    </div>
  )
}
