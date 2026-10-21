/**
 * Money is stored as an integer amount of the smallest unit (tiyin for UZS: 1 so‘m = 100 tiyin)
 * together with an explicit ISO currency code. Floats never touch monetary values.
 */
export type Currency = 'UZS'

export interface Money {
  /** Integer amount in the smallest unit (tiyin). Serialized as a string in JSON to stay exact. */
  amountMinor: bigint
  currency: Currency
}

export const TIYIN_PER_SOM = 100n

export const somToTiyin = (som: number | string | bigint): bigint => {
  if (typeof som === 'bigint') return som * TIYIN_PER_SOM
  const str = String(som).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(str)) throw new Error(`Invalid so'm amount: ${str}`)
  const [whole, frac = ''] = str.split('.')
  return BigInt(whole) * TIYIN_PER_SOM + BigInt((frac + '00').slice(0, 2))
}

export const tiyinToSom = (tiyin: bigint): number => Number(tiyin) / Number(TIYIN_PER_SOM)

/** Payme sends amounts in tiyin as integers; Click sends so'm with two decimals ("1725000.00"). */
export const tiyinToClickAmount = (tiyin: bigint): string => {
  const whole = tiyin / TIYIN_PER_SOM
  const frac = tiyin % TIYIN_PER_SOM
  return `${whole}.${frac.toString().padStart(2, '0')}`
}

export const serializeMoney = (m: Money) => ({ amountMinor: m.amountMinor.toString(), currency: m.currency })
