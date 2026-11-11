import { describe, expect, it } from 'vitest'
import { hoursLabel, translate } from './i18n.js'
import { PAYMENT_HOLD_HOURS } from './enrollment.js'

describe('hours in words', () => {
  it('declines the noun in Russian and English; Uzbek takes no counter word', () => {
    expect(['uz', 'ru', 'en'].map((l) => hoursLabel(l as 'uz', 1))).toEqual(['1 soat', '1 час', '1 hour'])
    expect(hoursLabel('ru', 2)).toBe('2 часа')
    expect(hoursLabel('ru', 24)).toBe('24 часа')
    expect(hoursLabel('ru', 5)).toBe('5 часов')
    expect(hoursLabel('en', 24)).toBe('24 hours')
  })

  it('the checkout note names the hold the API keeps (1 hour), not a day', () => {
    expect(PAYMENT_HOLD_HOURS).toBe(1)
    expect(translate('ru', 'checkout.note', { hold: hoursLabel('ru', PAYMENT_HOLD_HOURS) })).toContain('Места держатся за вами 1 час')
  })
})
