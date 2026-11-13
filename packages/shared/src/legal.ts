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

/**
 * Operator details. Legal name, INN and e-mail are as in section 14 of the offer; the phone (2026-11-13), the address
 * and the copyright name (2026-10-28) are the owner's current ones — the offer document still lists the earlier phone
 * and address. The Uzbek address is shown in the footer, so it is written in the site's alphabet (Ş, Ö) like the
 * rest of the interface, not in the official spelling the offer text keeps.
 */
export const OPERATOR: {
  legalName: L
  /** Company name as the owner wants it in the copyright line, identical in every language. */
  brandOwner: string
  inn: string
  address: L
  phone: string
  email: string
  website: string
} = {
  legalName: { uz: '«ANJIR-GROUP» MChJ', ru: 'ООО «ANJIR-GROUP»', en: 'ANJIR-GROUP LLC' },
  brandOwner: 'Anjir group LLC',
  inn: '312525684',
  address: {
    uz: 'Şayxontohur tumani, Qoratoş 106',
    ru: 'Шайхантахурский район, Каратош 106',
    en: 'Shaykhontohur district, Qoratosh 106',
  },
  phone: '+998 91 181 30 77',
  email: 'infoangirgroup@gmail.com',
  website: 'https://ilmoraa.uz',
}
