import type { TKey } from '@ilmora/shared'

export interface PasswordChangeFields { current: string; next: string; repeat: string }

/** The API's length rule for a new password (POST /auth/password, as at registration). */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

/**
 * The first problem with the form, checked here before the request (the API checks the same and answers with the
 * codes in brackets): the current password given, 8–128 characters, not the current one (same_password), not the login
 * (password_is_login), typed twice the same. Returns the text's key, or null when the form can be sent.
 */
export function passwordChangeProblem(f: PasswordChangeFields, login: string | null): TKey | null {
  if (!f.current) return 'pwd.err.current'
  if (f.next.length < PASSWORD_MIN || f.next.length > PASSWORD_MAX) return 'auth.err.password'
  if (f.next === f.current) return 'apiError.samePassword'
  if (login && f.next.toLowerCase() === login.toLowerCase()) return 'apiError.passwordIsLogin'
  if (f.next !== f.repeat) return 'auth.err.mismatch'
  return null
}
