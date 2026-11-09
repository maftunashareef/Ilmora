import type { L } from './types.js'

/**
 * Organizations that register themselves (besides an Educational Center): a technikum (state or private) and a company.
 * The registration form asks for the name, the region, the TIN (INN / STIR) and a contact phone; a technikum also
 * states whether it is state-owned or private.
 */
export type OrgKind = 'TECHNIKUM' | 'COMPANY'
export type OrgOwnership = 'STATE' | 'PRIVATE'

export const ORG_OWNERSHIPS: readonly OrgOwnership[] = ['STATE', 'PRIVATE']

/** The 14 top-level administrative units of Uzbekistan: Tashkent city, the Republic of Karakalpakstan and 12 regions. */
export const UZ_REGIONS: readonly { id: string; name: L }[] = [
  { id: 'tashkent-city', name: { uz: 'Toşkent şahri', ru: 'г. Ташкент', en: 'Tashkent city' } },
  { id: 'tashkent', name: { uz: 'Toşkent viloyati', ru: 'Ташкентская область', en: 'Tashkent region' } },
  { id: 'andijan', name: { uz: 'Andijon viloyati', ru: 'Андижанская область', en: 'Andijan region' } },
  { id: 'bukhara', name: { uz: 'Buxoro viloyati', ru: 'Бухарская область', en: 'Bukhara region' } },
  { id: 'fergana', name: { uz: 'Farğona viloyati', ru: 'Ферганская область', en: 'Fergana region' } },
  { id: 'jizzakh', name: { uz: 'Jizzax viloyati', ru: 'Джизакская область', en: 'Jizzakh region' } },
  { id: 'khorezm', name: { uz: 'Xorazm viloyati', ru: 'Хорезмская область', en: 'Khorezm region' } },
  { id: 'namangan', name: { uz: 'Namangan viloyati', ru: 'Наманганская область', en: 'Namangan region' } },
  { id: 'navoi', name: { uz: 'Navoiy viloyati', ru: 'Навоийская область', en: 'Navoi region' } },
  { id: 'kashkadarya', name: { uz: 'Qaşqadaryo viloyati', ru: 'Кашкадарьинская область', en: 'Kashkadarya region' } },
  { id: 'samarkand', name: { uz: 'Samarqand viloyati', ru: 'Самаркандская область', en: 'Samarkand region' } },
  { id: 'syrdarya', name: { uz: 'Sirdaryo viloyati', ru: 'Сырдарьинская область', en: 'Syrdarya region' } },
  { id: 'surkhandarya', name: { uz: 'Surxondaryo viloyati', ru: 'Сурхандарьинская область', en: 'Surkhandarya region' } },
  { id: 'karakalpakstan', name: { uz: 'Qoraqalpoğiston Respublikasi', ru: 'Республика Каракалпакстан', en: 'Republic of Karakalpakstan' } },
]

export const isUzRegion = (id: string): boolean => UZ_REGIONS.some((r) => r.id === id)

/** An Uzbek legal entity's TIN (INN / STIR) is 9 digits. Spaces and dashes typed by the user are ignored. */
export type InnParse = { ok: true; inn: string } | { ok: false; reason: 'empty' | 'invalid' }

export function normalizeUzInn(input: string): InnParse {
  if (!input || !input.trim()) return { ok: false, reason: 'empty' }
  const compact = input.replace(/[\s-]/g, '')
  return /^\d{9}$/.test(compact) ? { ok: true, inn: compact } : { ok: false, reason: 'invalid' }
}
