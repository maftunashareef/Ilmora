import { translate, type Lang } from '@ilmora/shared'
import { isApiError } from '../lib/api'
import { apiErrorText } from '../lib/apiErrors'

/** What the representative was doing: saving the profile (or its directions) or sending it for review. */
export type OrgAction = 'save' | 'submit'
/** The API's limits per account (companies and institutions controllers): 30 saves and 10 submissions an hour. */
export const ORG_LIMITS: Record<OrgAction, number> = { save: 30, submit: 10 }

/**
 * An error of the company profile or the institution passport, in words: 403 `forbidden` there means the Super Admin
 * blocked the organization (no edits, no submission); a 429 names the hourly limit. Anything else — as everywhere.
 * The API's `Retry-After` is not shown: the error filter answers 60 seconds whatever the hourly limit has left.
 */
export function orgErrorText(err: unknown, lang: Lang, action?: OrgAction): string {
  if (isApiError(err) && err.status === 403 && err.code === 'forbidden') return translate(lang, 'org.blocked')
  if (action && isApiError(err) && err.status === 429) return translate(lang, action === 'save' ? 'org.limit.save' : 'org.limit.submit', { n: ORG_LIMITS[action] })
  return apiErrorText(err, lang)
}
