import { discountSom, type DiscountDraft, emptyDiscountDraft, MAX_DISCOUNT_PERCENT } from '@ilmora/shared'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { Button, Field, Input } from '../ui'

/**
 * Discount form fields shared by the Super Admin course editor and the center workspace: percent (1 to the company
 * maximum), start and end in Tashkent time (an end is required, a future start is fine), plus the resulting price.
 */
export function DiscountFields({ value, onChange, price }: { value: DiscountDraft; onChange: (v: DiscountDraft) => void; price: number }) {
  const { t, lang } = useT()
  const percent = Number(value.percent)
  const validPercent = value.percent !== '' && Number.isInteger(percent) && percent >= 1 && percent <= MAX_DISCOUNT_PERCENT
  const any = !!(value.percent || value.starts || value.ends)
  const set = (patch: Partial<DiscountDraft>) => onChange({ ...value, ...patch })
  return (
    <div className="rounded-card border border-charcoal/10 bg-ivory/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-charcoal">{t('discount.title')}</div>
        {any && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(emptyDiscountDraft())}>{t('discount.remove')}</Button>}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={`${t('discount.percent')} (1–${MAX_DISCOUNT_PERCENT}%)`}><Input type="number" min={1} max={MAX_DISCOUNT_PERCENT} step={1} value={value.percent} onChange={(e) => set({ percent: e.target.value })} /></Field>
        <Field label={t('discount.starts')}><Input type="datetime-local" value={value.starts} onChange={(e) => set({ starts: e.target.value })} /></Field>
        <Field label={t('discount.ends')}><Input type="datetime-local" value={value.ends} onChange={(e) => set({ ends: e.target.value })} /></Field>
      </div>
      <p className="mt-2 text-xs text-charcoal/55">{t('discount.hint')}</p>
      {validPercent && <p className="mt-1 text-xs font-medium text-forest">{t('discount.preview', { price: formatSom(price - discountSom(price, percent), lang, false) })}</p>}
    </div>
  )
}
