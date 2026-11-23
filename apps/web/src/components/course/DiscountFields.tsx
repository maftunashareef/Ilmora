import { calculatorSom, checkCoursePrice, COMMISSION_DEFAULT_PERCENT, DISCOUNT_TERMS, type DiscountDraft, type DiscountTermId, discountTermEnd, discountTermOf, emptyDiscountDraft, HALF_SPLIT_MAX_TOTAL_PERCENT, HALF_SPLIT_MIN_TOTAL_PERCENT, maxDiscountPercent, maxDiscountPercentFor, MIN_COURSE_PRICE_SOM, MIN_DISCOUNT_PERCENT, type PriceRule, tashkentNowLocal } from '@ilmora/shared'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { Button, Field, FieldGroup, Input, Segmented } from '../ui'

/** ILMORA's commission and the discount range the API reports (GET /center/courses → `pricing`, GET /admin/pricing). */
export interface Pricing { commissionPercent: number; minDiscountPercent: number; maxDiscountPercent: number; minPriceSom: number }
const DEFAULT_PRICING: Pricing = { commissionPercent: COMMISSION_DEFAULT_PERCENT, minDiscountPercent: MIN_DISCOUNT_PERCENT, maxDiscountPercent: maxDiscountPercent(COMMISSION_DEFAULT_PERCENT), minPriceSom: MIN_COURSE_PRICE_SOM }

/** The total X shown for a draft's S (the draft and the server keep S, the student's half): '' stays '', 7.5 shows 15. */
const totalOf = (percent: string): string => (percent === '' || !Number.isFinite(Number(percent)) ? '' : String(Number(percent) * 2))
/** …and back: the total typed in → S. An odd total gives a half percent, which no check accepts. */
const halfOf = (total: string): string => (total === '' ? '' : String(Number(total) / 2))

/**
 * The student discount with the price calculator (ТЗ 2026-11-18, 9.3), shared by the Super Admin course editor and the
 * center workspace, with a start in Tashkent time, the term and the live split: the student's price, what the center
 * gets, what ILMORA gets.
 * A course of the calculator (rule 1) splits in equal halves (23.11): the center types one total percent X — even, from
 * 10 to 100 — the form keeps S = X / 2 (the student's discount, as stored) and ILMORA's commission is the same S.
 * A course from before the calculator (rule 0) keeps its own fields: S from 5% to 100% − K, ILMORA's K shown, never
 * edited, its old rounding in the preview.
 * The term (22.11) is the center's choice: «permanent» — no end, or «time-limited» — 10 days, 1, 2 or 3 months from the
 * start, or any date. After a time-limited discount a new course keeps the minimum (5% + 5%); a course from before has none.
 */
export function DiscountFields({ value, onChange, price, pricing = DEFAULT_PRICING, priceRule = 1 }: { value: DiscountDraft; onChange: (v: DiscountDraft) => void; price: number; pricing?: Pricing; priceRule?: PriceRule }) {
  const { t, lang } = useT()
  const half = priceRule === 1
  const set = (patch: Partial<DiscountDraft>) => onChange({ ...value, ...patch })
  const percent = Number(value.percent)
  // The largest S: 50% on a course of the calculator (a total of 100%), 100% − K on an older one.
  const maxPercent = maxDiscountPercentFor(priceRule, pricing.commissionPercent)
  const validPercent = value.percent !== '' && Number.isInteger(percent) && percent >= pricing.minDiscountPercent && percent <= maxPercent
  // Rule 1: the field shows the total; an odd one is a half percent underneath and gets its own hint.
  const shown = half ? totalOf(value.percent) : value.percent
  const odd = half && shown !== '' && Number.isInteger(Number(shown)) && Number(shown) % 2 !== 0
  const setShown = (text: string) => set({ percent: half ? halfOf(text) : text })
  const fieldMin = half ? HALF_SPLIT_MIN_TOTAL_PERCENT : pricing.minDiscountPercent
  const fieldMax = half ? HALF_SPLIT_MAX_TOTAL_PERCENT : maxPercent
  const fieldStep = half ? 2 : 1
  const any = !!(value.percent || value.starts || value.ends)
  const priceOk = priceRule === 0 || checkCoursePrice(price).ok
  const split = calculatorSom(price, validPercent ? percent : 0, pricing.commissionPercent, priceRule)
  const som = (n: number) => formatSom(n, lang, true)
  const minimum = { total: 2 * pricing.minDiscountPercent, min: pricing.minDiscountPercent }
  // The term: an empty end is a permanent discount; an end makes it time-limited. A quick term counts from the start,
  // so it fills an empty start with «now» and moves with the start while that button stays chosen.
  const timed = value.ends !== ''
  const term = discountTermOf(value)
  const pickTerm = (id: DiscountTermId) => {
    const starts = value.starts || tashkentNowLocal()
    set({ starts, ends: discountTermEnd(starts, id) })
  }
  const setStart = (starts: string) => set({ starts, ...(term && starts ? { ends: discountTermEnd(starts, term) } : {}) })
  const bad = shown !== '' && !validPercent
  return (
    <div className="rounded-card border border-charcoal/10 bg-ivory/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-charcoal">{t('calc.title')}</div>
        {any && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(emptyDiscountDraft())}>{t('discount.remove')}</Button>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={half ? t('calc.totalRange', { min: fieldMin, max: fieldMax }) : t('calc.discountRange', { min: fieldMin, max: fieldMax })}>
          <Input type="number" min={fieldMin} max={fieldMax} step={fieldStep} value={shown} aria-invalid={bad} className={bad ? 'border-red-400 ring-2 ring-red-200' : undefined} onChange={(e) => setShown(e.target.value)} />
          <input type="range" aria-hidden="true" tabIndex={-1} min={fieldMin} max={fieldMax} step={fieldStep} value={validPercent ? shown : fieldMin} onChange={(e) => setShown(e.target.value)} className="mt-2 w-full accent-forest" />
          {odd && <p className="mt-1 text-xs text-red-700">{t('calc.even')}</p>}
        </Field>
        <Field label={t('discount.starts')}><Input type="datetime-local" value={value.starts} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
      {half ? (
        <div className="mt-3 space-y-2 text-xs text-charcoal/65">
          {validPercent && <span className="inline-block rounded-full bg-sage px-2.5 py-1 font-medium text-forest">{t('calc.halvesNow', { s: percent, k: percent })}</span>}
          <p>{t('calc.halves')}</p>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-charcoal/65"><span className="rounded-full bg-sage px-2.5 py-1 font-medium text-forest">{t('calc.commission', { k: pricing.commissionPercent })}</span>{t('calc.commissionHint')}</div>
      )}
      <FieldGroup label={t('calc.term')} className="mt-4">
        <Segmented options={[{ id: 'permanent', label: t('calc.permanent') }, { id: 'timed', label: t('calc.timed') }]} value={timed ? 'timed' : 'permanent'} onChange={(v) => { if (v === 'permanent') set({ ends: '' }); else if (!timed) pickTerm(DISCOUNT_TERMS[0].id) }} />
        {timed ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-end">
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('calc.timed')}>
              {DISCOUNT_TERMS.map((x) => (
                <button key={x.id} type="button" aria-pressed={term === x.id} onClick={() => pickTerm(x.id)} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${term === x.id ? 'border-forest bg-forest text-ivory' : 'border-charcoal/15 bg-paper text-charcoal/70 hover:border-forest/40 hover:text-charcoal'}`}>{t(`calc.term.${x.id}`)}</button>
              ))}
            </div>
            <Field label={t('discount.ends')}><Input type="datetime-local" value={value.ends} min={value.starts || undefined} onChange={(e) => { if (e.target.value) set({ ends: e.target.value }) }} /></Field>
            <p className="text-xs text-charcoal/60 sm:col-span-2">{half ? t('calc.afterTerm', minimum) : t('calc.afterTermOld')}</p>
          </div>
        ) : <p className="mt-2 text-xs text-charcoal/60">{t('calc.noEnd')}</p>}
      </FieldGroup>
      <p className="mt-2 text-xs text-charcoal/55">{t('discount.hint')}{half ? ` ${t('calc.required', minimum)}` : ''}</p>
      {price === 0 ? <p className="mt-3 text-xs text-charcoal/60">{t('calc.free')}</p> : !priceOk ? (
        <p className="mt-3 text-xs text-red-700">{t('calc.priceStep', { min: formatSom(pricing.minPriceSom, lang, false) })}</p>
      ) : (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3" aria-live="polite">
          <div className="rounded-control bg-paper px-3 py-2"><dt className="text-xs text-charcoal/55">{t('calc.student')}</dt><dd className="font-medium text-charcoal">{som(split.student)}</dd></div>
          <div className="rounded-control bg-paper px-3 py-2"><dt className="text-xs text-charcoal/55">{t('calc.center')}</dt><dd className="font-medium text-forest">{som(split.center)}</dd></div>
          <div className="rounded-control bg-paper px-3 py-2"><dt className="text-xs text-charcoal/55">{t('calc.platform')}</dt><dd className="font-medium text-charcoal">{som(split.platform)}</dd></div>
        </dl>
      )}
    </div>
  )
}
