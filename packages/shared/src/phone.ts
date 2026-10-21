/**
 * Phone normalization for Uzbekistan (+998) without external dependencies.
 * Identity model: one account per normalized E.164 number per tenant.
 *
 * Accepted inputs: "+998 90 123 45 67", "998901234567", "90 123 45 67", "0901234567" (local trunk form).
 * Output: "+998901234567". Anything that is not a 9-digit Uzbek subscriber number is rejected.
 */
export const UZ_COUNTRY_CODE = '998'

export type PhoneParse = { ok: true; e164: string; national: string } | { ok: false; reason: 'empty' | 'invalid' }

export function normalizeUzPhone(input: string): PhoneParse {
  if (!input || !input.trim()) return { ok: false, reason: 'empty' }
  let digits = input.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 9) digits = UZ_COUNTRY_CODE + digits
  if (digits.length !== 12 || !digits.startsWith(UZ_COUNTRY_CODE)) return { ok: false, reason: 'invalid' }
  const national = digits.slice(3)
  // Uzbek mobile/landline numbers: 9 digits, operator code 2x/3x/5x/6x/7x/8x/9x; never starts with 0 or 1.
  if (!/^[2-9]\d{8}$/.test(national)) return { ok: false, reason: 'invalid' }
  return { ok: true, e164: `+${digits}`, national }
}

/** "+998901234567" → "+998 90 123 45 67" */
export function formatUzPhone(e164: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164)
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164
}

/** Masked form for logs and UI: "+998 90 *** ** 67". Never log the full number. */
export function maskPhone(e164: string): string {
  const m = /^\+998(\d{2})\d{5}(\d{2})$/.exec(e164)
  return m ? `+998 ${m[1]} *** ** ${m[2]}` : '***'
}
