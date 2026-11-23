import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The UI kit imports the router through the '@/' alias, which only Next resolves; the form never renders a link.
vi.mock('@/lib/router', () => ({ Link: () => null }))
// The texts in Uzbek, without the app's store.
vi.mock('../../i18n/useT', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../i18n/useT')>()
  return { ...real, useT: () => ({ t: (key: Parameters<typeof real.translate>[1], vars?: Record<string, string | number>) => real.translate('uz', key, vars), tr: () => '', lang: 'uz' as const }) }
})
import { emptyDiscountDraft, type DiscountDraft } from '@ilmora/shared'
import { DiscountFields } from './DiscountFields'

/**
 * The calculator in the course form (23.11, equal halves): on a course of the calculator the center types the total X,
 * the draft keeps S = X / 2; an odd X gets its hint; ILMORA's sum is the student's saving. A course from before keeps its
 * own field (S, up to 100% − K) and the K badge.
 */
const pricing = { commissionPercent: 10, minDiscountPercent: 5, maxDiscountPercent: 90, minPriceSom: 50_000 }
const draft = (percent: string): DiscountDraft => ({ ...emptyDiscountDraft(), percent })
const html = (value: DiscountDraft, price: number, priceRule: 0 | 1) =>
  renderToStaticMarkup(<DiscountFields value={value} onChange={() => undefined} price={price} pricing={pricing} priceRule={priceRule} />)
const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| | /g, ' ').replace(/\s+/g, ' ')
/** The three sums in order — the student's price, the center's share, ILMORA's — as numbers. */
const sums = (out: string) => [...out.matchAll(/<dd[^>]*>([^<]*)<\/dd>/g)].map((m) => Number(m[1].replace(/\D/g, '')))

describe('DiscountFields, a course of the calculator (rule 1): equal halves', () => {
  it('shows the stored S as the total, the halves and the three sums: 500 000 at 20% → 450 000 / 400 000 / 50 000', () => {
    const out = html(draft('10'), 500_000, 1)
    expect(out).toMatch(/<input type="number" min="10" max="100" step="2" aria-invalid="false"[^>]* value="20"\/>/)
    const t = text(out)
    expect(t).toContain('Jami foiz (10–100%, juft son)')
    expect(t).toContain('Talabaga 10% · ILMORAga 10%')
    expect(t).toContain('Yarmi — talabaga çegirma, yarmi — ILMORA komissiyasi.')
    expect(t).not.toContain('ILMORA belgilaydi')
    expect(t).toContain('Pullik kursda eng kami — 10% (5% talabaga, 5% ILMORAga).')
    expect(sums(out)).toEqual([450_000, 400_000, 50_000])
    expect(out).not.toContain('aria-invalid="true"')
    // 1 234 000 at a total of 14%: whole thousands, ILMORA gets what the student saves.
    expect(sums(html(draft('7'), 1_234_000, 1))).toEqual([1_147_000, 1_060_000, 87_000])
  })
  it('an odd total (15 → S 7.5) is invalid and says to type an even number', () => {
    const out = html(draft('7.5'), 500_000, 1)
    expect(out).toMatch(/<input type="number"[^>]* value="15"\/>/)
    expect(out).toContain('aria-invalid="true"')
    expect(text(out)).toContain('Juft son kiriting: 10, 12, 14 …')
  })
  it('permanent and time-limited: short notes, the minimum after a term is 5% + 5%', () => {
    expect(text(html(draft('10'), 500_000, 1))).toContain('Çegirma muddatsiz — özingiz özgartirmaguningizça turadi.')
    const timed = { percent: '10', starts: '2026-11-01T10:00', ends: '2026-11-11T10:00' }
    expect(text(html(timed, 500_000, 1))).toContain('Muddat tugagaç jami 10% qoladi: 5% talabaga, 5% ILMORAga.')
    expect(text(html(timed, 500_000, 0))).toContain('Muddat tugagaç kurs öz narxiga qaytadi.')
  })
  it('a total above 100 (S 51) is invalid; 100 (S 50) is the limit', () => {
    expect(html(draft('51'), 1_000_000, 1)).toContain('aria-invalid="true"')
    expect(html(draft('50'), 1_000_000, 1)).not.toContain('aria-invalid="true"')
  })
})

describe('DiscountFields, a course from before the calculator (rule 0)', () => {
  it('keeps the student discount field up to 100% − K and the K badge, without the halves', () => {
    const out = html(draft('60'), 500_000, 0)
    expect(out).toMatch(/<input type="number" min="5" max="90" step="1" aria-invalid="false"[^>]* value="60"\/>/)
    // 500 000 at 60%, K 10%: the student 200 000, the center 150 000, ILMORA 50 000.
    expect(sums(out)).toEqual([200_000, 150_000, 50_000])
    const t = text(out)
    expect(t).toContain('Talabaga çegirma (5–90%)')
    expect(t).toContain('ILMORA komissiyasi: 10%')
    expect(t).not.toContain('Yarmi —')
    expect(t).not.toContain('Pullik kursda eng kami')
    expect(out).not.toContain('aria-invalid="true"')
  })
})
