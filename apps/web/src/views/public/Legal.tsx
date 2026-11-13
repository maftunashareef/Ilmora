'use client'
import { LANGS, OFFER_STATUS, OFFER_TEXT, OFFER_VERSION, OPERATOR, pick, type LegalBlock } from '@ilmora/shared'
import { Card, Eyebrow, Notice, PageTitle } from '../../components/ui'
import { langName } from '../../components/ui/helpers'
import { useT } from '../../i18n/useT'
import { Link } from '../../lib/router'
import type { Lang } from '../../types'

const EDITION_LABEL = '21.10.2026'

/** The owner has supplied the offer in Uzbek (governing) and Russian only; a missing language shows the Uzbek text. */
const FALLBACK_LANG: Lang = 'uz'

/** Shown when the document has no text in the interface language, with links to the other editions that do exist. */
function MissingLanguageNotice({ path }: { path: string }) {
  const { t } = useT()
  const others = LANGS.map((l) => l.code).filter((code) => code !== FALLBACK_LANG && OFFER_TEXT[code])
  return (
    <Notice tone="info" className="mb-6 text-xs">
      {t('legal.ruOnly')}
      {others.map((code) => (
        <span key={code}> · <Link to={`/${code}${path}`} className="font-medium underline" lang={code}>{langName(code)}</Link></span>
      ))}
    </Notice>
  )
}

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

/** Public offer: the owner's document in the interface language when supplied (uz, ru), otherwise the governing Uzbek text with a notice. */
export function OfferPage() {
  const { t, lang } = useT()
  const own = OFFER_TEXT[lang]
  const blocks = own ?? OFFER_TEXT[FALLBACK_LANG] ?? []
  return (
    <div className="container-x py-12 lg:py-16">
      <div className="mx-auto max-w-3xl">
        <Eyebrow className="mb-3">{t('legal.offer')} · {t('legal.edition')} {OFFER_VERSION}</Eyebrow>
        {OFFER_STATUS === 'draft' && <Notice tone="warn" className="mb-4 text-xs">{t('legal.draftNotice', { date: EDITION_LABEL })}</Notice>}
        {!own && <MissingLanguageNotice path="/oferta" />}
        <Card className="px-6 py-8 sm:px-10">
          <div lang={own ? lang : FALLBACK_LANG}><Blocks blocks={blocks} /></div>
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
  const all = OFFER_TEXT[lang] ?? OFFER_TEXT[FALLBACK_LANG] ?? []
  const idx = (re: RegExp) => all.findIndex((b) => b.t === 'h2' && re.test(b.text))
  const s9 = idx(/^9\./)
  const s10 = idx(/^10\./)
  const a1 = idx(/^(Приложение 1|1-ilova)/)
  const a2 = idx(/^(Приложение 2|2-ilova)/)
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
        {!OFFER_TEXT[lang] && <MissingLanguageNotice path="/privacy" />}
        <Card className="px-6 py-8 sm:px-10">
          <div lang={OFFER_TEXT[lang] ? lang : FALLBACK_LANG}><Blocks blocks={blocks} /></div>
        </Card>
        <p className="mt-6 text-xs text-charcoal/50"><Link to="/oferta" className="underline">{t('legal.offer')}</Link></p>
      </div>
    </div>
  )
}
