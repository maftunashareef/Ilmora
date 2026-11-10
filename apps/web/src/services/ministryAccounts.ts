import type { MinistryAccountCreatedDto, MinistryAccountDto } from '@ilmora/shared'
import { api } from '../lib/api'

/** What the Super Admin types for a new ministry account (ТЗ 4.4): the login stays, the rest can be edited later. */
export interface MinistryAccountForm { login: string; name: string; jobTitle: string; email: string }

/** Same rule as the API (`AccountService.normalizeLogin`): 3–32 Latin letters, digits, dot, underscore or dash. */
export const MINISTRY_LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/
export const normalizeLogin = (raw: string) => raw.normalize('NFKC').trim().toLowerCase()
const squash = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ')

/** The create body: empty job title and email are left out (the API refuses an empty job title). */
export function createBody(f: MinistryAccountForm) {
  const jobTitle = squash(f.jobTitle)
  const email = f.email.trim()
  return { login: normalizeLogin(f.login), name: squash(f.name), ...(jobTitle ? { jobTitle } : {}), ...(email ? { email } : {}) }
}

/** The edit body: an emptied job title or email is cleared (null), not sent as an empty string. */
export function patchBody(f: Omit<MinistryAccountForm, 'login'>) {
  const jobTitle = squash(f.jobTitle)
  const email = f.email.trim()
  return { name: squash(f.name), jobTitle: jobTitle || null, email: email || null }
}

/** Super Admin calls for ministry accounts and second-factor resets (`/v1/admin/ministry-accounts`, PR #23). */
export const ministryAccounts = {
  list: () => api<MinistryAccountDto[]>('/admin/ministry-accounts'),
  create: (f: MinistryAccountForm) => api<MinistryAccountCreatedDto>('/admin/ministry-accounts', { method: 'POST', body: createBody(f) }),
  update: (id: string, f: Omit<MinistryAccountForm, 'login'>) => api<MinistryAccountDto>(`/admin/ministry-accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: patchBody(f) }),
  /** Disabled: no sign-in, open sessions end at once. */
  setActive: (id: string, active: boolean) => api<MinistryAccountDto>(`/admin/ministry-accounts/${encodeURIComponent(id)}/${active ? 'enable' : 'disable'}`, { method: 'POST' }),
  /** A new temporary password, shown once; open sessions end. */
  resetPassword: (id: string) => api<MinistryAccountCreatedDto>(`/admin/ministry-accounts/${encodeURIComponent(id)}/reset-password`, { method: 'POST' }),
  /** Lost phone: unlinks the authenticator app of a ministry account or of another Super Admin; the next sign-in shows the QR code. */
  resetApp: (id: string) => api<{ ok: true }>(`/admin/accounts/${encodeURIComponent(id)}/reset-second-factor`, { method: 'POST' }),
  /**
   * «Сбросить пароль» for any account with a login but a Super Admin (PR #54): a temporary password shown once; every
   * session ends and the next sign-in asks for a new password (403 password_change_required until then).
   */
  resetAccountPassword: (id: string) => api<{ temporaryPassword: string }>(`/admin/accounts/${encodeURIComponent(id)}/reset-password`, { method: 'POST' }),
}
