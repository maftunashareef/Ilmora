import { from, interval, merge, type Observable, timer } from 'rxjs'
import { concatMap, filter, finalize, takeUntil } from 'rxjs/operators'
import type { AuthenticatedRequest } from './decorators'
import { AppError } from './errors'
import { ACTOR_CHECK_MS } from './request-context.middleware'

/** Live streams (server-sent events) one account may hold open at once, per kind, in one API process (re-check 11.11 №92). */
export const MAX_STREAMS_PER_ACCOUNT = 5

const open = new Map<string, number>()

/**
 * A live stream of a signed-in request, tied to its session (re-check 11.11 №92). It ends when the access token
 * expires, or when the account no longer matches the token — password changed, account disabled, roles taken away —
 * checked every ACTOR_CHECK_MS; the site then reconnects with its current token. At most MAX_STREAMS_PER_ACCOUNT streams
 * of one kind per account; one more answers 429.
 */
export function sessionBound<T>(req: AuthenticatedRequest, kind: string, source: Observable<T>, checkMs = ACTOR_CHECK_MS): Observable<T> {
  const userId = req.actor?.id
  const session = req.session
  if (!userId || !session) throw AppError.unauthorized('Authentication required')
  const key = `${kind}:${userId}`
  const count = open.get(key) ?? 0
  if (count >= MAX_STREAMS_PER_ACCOUNT) throw AppError.tooMany('Too many live connections for this account; close another tab', 30)
  open.set(key, count + 1)
  let released = false
  const release = () => {
    if (released) return
    released = true
    const left = (open.get(key) ?? 1) - 1
    if (left > 0) open.set(key, left)
    else open.delete(key)
  }
  // The client may leave before the stream is subscribed: the seat is given back either way.
  req.once?.('close', release)
  const ended = merge(
    timer(Math.max(0, session.expiresAt - Date.now())),
    interval(checkMs).pipe(concatMap(() => from(session.stillCurrent())), filter((current) => !current)),
  )
  return source.pipe(takeUntil(ended), finalize(release))
}

/** Streams open now for one account and kind (tests and diagnostics). */
export const openStreams = (kind: string, userId: string): number => open.get(`${kind}:${userId}`) ?? 0
