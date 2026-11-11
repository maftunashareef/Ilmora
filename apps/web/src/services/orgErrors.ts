import { translate, type Lang } from '@ilmora/shared'
import { isApiError } from '../lib/api'
import { apiErrorText, retryMinutes } from '../lib/apiErrors'

/** What the representative was doing: saving the profile (or its directions) or sending it for review. */
export type OrgAction = 'save' | 'submit'
/** The API's limits per account (companies and institutions controllers): 30 saves and 10 submissions an hour. */
export const ORG_LIMITS: Record<OrgAction, number> = { save: 30, submit: 10 }

/**
 * An error of the company profile or the institution passport, in words: 403 `forbidden` there means the Super Admin
 * blocked the organization (no edits, no submission); a 429 names the hourly limit and how long to wait (the API's
 * `retryAfterSeconds`). Anything else — as everywhere.
 */
export function orgErrorText(err: unknown, lang: Lang, action?: OrgAction): string {
  if (isApiError(err) && err.status === 403 && err.code === 'forbidden') return translate(lang, 'org.blocked')
  if (action && isApiError(err) && err.status === 429) {
    const m = retryMinutes(err)
    const key = action === 'save' ? (m ? 'org.limit.saveIn' : 'org.limit.save') : (m ? 'org.limit.submitIn' : 'org.limit.submit')
    return translate(lang, key, { n: ORG_LIMITS[action], m: m ?? 0 })
  }
  return apiErrorText(err, lang)
}
