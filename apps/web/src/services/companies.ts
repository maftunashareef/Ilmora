import { api } from '../lib/api'

export interface CompanyStart {
  stir: string
  name: string
  /** The representative's email: sign-up does not take it, the company profile does. */
  email: string
}

/**
 * ТЗ 4.3, right after the representative's account is created: the STIR and the name start the company profile
 * (`POST /v1/companies`; a STIR already registered fails with `company_registered`, "write to support"). The
 * representative's email then goes to the profile (`PATCH /v1/companies/me`); if that fails the profile still exists
 * and the email is entered there.
 */
export async function startCompany(c: CompanyStart): Promise<{ emailSaved: boolean }> {
  await api('/companies', { method: 'POST', body: { stir: c.stir, name: c.name.trim() } })
  try {
    await api('/companies/me', { method: 'PATCH', body: { representative: { email: c.email.trim() } } })
    return { emailSaved: true }
  } catch {
    return { emailSaved: false }
  }
}
