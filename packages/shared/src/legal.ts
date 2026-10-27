import type { L, Lang } from './types.js'
import type { LegalBlock } from './legal-types.js'
import { OFFER_RU } from './legal-offer-ru.js'
import { OFFER_UZ } from './legal-offer-uz.js'

export type { LegalBlock } from './legal-types.js'

/** Edition date of the public offer. Accounts that accepted an older edition are asked to accept again. */
export const OFFER_VERSION = '2026-10-21'

/** The owner's document is still a draft with blanks to fill in; the site says so until a final edition replaces it. */
export const OFFER_STATUS: 'draft' | 'final' = 'draft'

/** Offer text by language. `null` = not supplied by the owner; the Uzbek text (the governing one) is shown with a notice. */
export const OFFER_TEXT: Record<Lang, LegalBlock[] | null> = { uz: OFFER_UZ, ru: OFFER_RU, en: null }

/** Operator details exactly as stated in section 14 of the offer (fields the document leaves blank are omitted). */
export const OPERATOR: {
  legalName: L
  inn: string
  address: L
  phone: string
  email: string
  website: string
} = {
  legalName: { uz: '«ANJIR-GROUP» MChJ', ru: 'ООО «ANJIR-GROUP»', en: 'ANJIR-GROUP LLC' },
  inn: '312525684',
  address: {
    uz: 'Toshkent shahri, Shayxontohur tumani, Hadra MFY, Hadra mavzesi, 5-uy, 54-xonadon',
    ru: 'г. Ташкент, Шайхантахурский район, МСГ Хадра, массив Хадра, дом 5, кв. 54',
    en: 'Tashkent, Shaykhantakhur district, Khadra MSG, Khadra massif, house 5, apt. 54',
  },
  phone: '+998 95 662 30 70',
  email: 'infoangirgroup@gmail.com',
  website: 'https://ilmoraa.uz',
}
