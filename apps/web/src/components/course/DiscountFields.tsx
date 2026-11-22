import { calculatorSom, checkCoursePrice, COMMISSION_DEFAULT_PERCENT, DISCOUNT_TERMS, type DiscountDraft, type DiscountTermId, discountTermEnd, discountTermOf, emptyDiscountDraft, maxDiscountPercent, MIN_COURSE_PRICE_SOM, MIN_DISCOUNT_PERCENT, type PriceRule, studentPriceSom, tashkentNowLocal } from '@ilmora/shared'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { Button, Field, FieldGroup, Input, Segmented } from '../ui'

/** ILMORA's commission and the discount range the API reports (GET /center/courses → `pricing`, GET /admin/pricing). */
export interface Pricing { commissionPercent: number; minDiscountPercent: number; maxDiscountPercent: number; minPriceSom: number }
const DEFAULT_PRICING: Pricing = { commissionPercent: COMMISSION_DEFAULT_PERCENT, minDiscountPercent: MIN_DISCOUNT_PERCENT, maxDiscountPercent: maxDiscountPercent(COMMISSION_DEFAULT_PERCENT), minPriceSom: MIN_COURSE_PRICE_SOM }

/**
 * The student discount with the price calculator (ТЗ 2026-11-18, 9.3), shared by the Super Admin course editor and the
 * center workspace: percent from 5% to 100% − K, a start in Tashkent time, the term, ILMORA's commission shown, never
 * edited, and the live split: the student's price, what the center gets, what ILMORA gets.
 * The term (22.11) is the center's choice: «permanent» — no end, or «time-limited» — 10 days, 1, 2 or 3 months from the
 * start, or any date. After a time-limited discount a new course keeps the minimum (5%); a course from before has none.
 * A course from before the calculator (rule 0) keeps its old rounding in the preview; the split is shown all the same.
 */
export function DiscountFields({ value, onChange, price, pricing = DEFAULT_PRICING, priceRule = 1 }: { value: DiscountDraft; onChange: (v: DiscountDraft) => void; price: number; pricing?: Pricing; priceRule?: PriceRule }) {
  const { t, lang } = useT()
  const percent = Number(value.percent)
  const validPercent = value.percent !== '' && Number.isInteger(percent) && percent >= pricing.minDiscountPercent && percent <= pricing.maxDiscountPercent
  const any = !!(value.percent || value.starts || value.ends)
  const set = (patch: Partial<DiscountDraft>) => onChange({ ...value, ...patch })
  const priceOk = priceRule === 0 || checkCoursePrice(price).ok
  const split = calculatorSom(price, validPercent ? percent : 0, pricing.commissionPercent)
  const student = validPercent ? studentPriceSom(price, percent, priceRule) : price
  const som = (n: number) => formatSom(n, lang, true)
  // The term: an empty end is a permanent discount; an end makes it time-limited. A quick term counts from the start,
  // so it fills an empty start with «now» and moves with the start while that button stays chosen.
  const timed = value.ends !== ''
  const term = discountTermOf(value)
  const pickTerm = (id: DiscountTermId) => {
    const starts = value.starts || tashkentNowLocal()
    set({ starts, ends: discountTermEnd(starts, id) })
  }
  const setStart = (starts: string) => set({ starts, ...(term && starts ? { ends: discountTermEnd(starts, term) } : {}) })
  return (
    <div className="rounded-card border border-charcoal/10 bg-ivory/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-charcoal">{t('calc.title')}</div>
        {any && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(emptyDiscountDraft())}>{t('discount.remove')}</Button>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('calc.discountRange', { min: pricing.minDiscountPercent, max: pricing.maxDiscountPercent })}>
          <Input type="number" min={pricing.minDiscountPercent} max={pricing.maxDiscountPercent} step={1} value={value.percent} aria-invalid={value.percent !== '' && !validPercent} className={value.percent !== '' && !validPercent ? 'border-red-400 ring-2 ring-red-200' : undefined} onChange={(e) => set({ percent: e.target.value })} />
          <input type="range" aria-hidden="true" tabIndex={-1} min={pricing.minDiscountPercent} max={pricing.maxDiscountPercent} step={1} value={validPercent ? percent : pricing.minDiscountPercent} onChange={(e) => set({ percent: e.target.value })} className="mt-2 w-full accent-forest" />
        </Field>
        <Field label={t('discount.starts')}><Input type="datetime-local" value={value.starts} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
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
            <p className="text-xs text-charcoal/60 sm:col-span-2">{priceRule === 1 ? t('calc.afterTerm', { min: pricing.minDiscountPercent }) : t('calc.afterTermOld')}</p>
          </div>
        ) : <p className="mt-2 text-xs text-charcoal/60">{t('calc.noEnd')}</p>}
      </FieldGroup>
      <p className="mt-2 text-xs text-charcoal/55">{t('discount.hint')} {t('calc.required', { min: pricing.minDiscountPercent })}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-charcoal/65"><span className="rounded-full bg-sage px-2.5 py-1 font-medium text-forest">{t('calc.commission', { k: pricing.commissionPercent })}</span>{t('calc.commissionHint')}</div>
      {price === 0 ? <p className="mt-3 text-xs text-charcoal/60">{t('calc.free')}</p> : !priceOk ? (
        <p className="mt-3 text-xs text-red-700">{t('calc.priceStep', { min: formatSom(pricing.minPriceSom, lang, false) })}</p>
      ) : (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3" aria-live="polite">
          <div className="rounded-control bg-paper px-3 py-2"><dt className="text-xs text-charcoal/55">{t('calc.student')}</dt><dd className="font-medium text-charcoal">{som(student)}</dd></div>
          <div className="rounded-control bg-paper px-3 py-2"><dt className="text-xs text-charcoal/55">{t('calc.center')}</dt><dd className="font-medium text-forest">{som(split.center)}</dd></div>
          <div className="rounded-control bg-paper px-3 py-2"><dt className="text-xs text-charcoal/55">{t('calc.platform')}</dt><dd className="font-medium text-charcoal">{som(student - split.center)}</dd></div>
        </dl>
      )}
    </div>
  )
}
