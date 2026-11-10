import { isApiError } from './api'

export type PaymentState = 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED'

/** Why the page stopped asking without a final answer: the server could not be reached, or the payment is still pending. */
export type PollStop = { reason: 'unreachable'; error: unknown } | { reason: 'refused'; error: unknown } | { reason: 'still_pending' }

export interface PaymentPollOptions<S extends { state: PaymentState }> {
  fetch: () => Promise<S>
  onStatus: (status: S) => void
  /** Called once when the page stops asking before the payment settled. */
  onStop: (stop: PollStop) => void
  /** Pause between answers while the payment is pending. */
  intervalMs?: number
  /** How many requests in all (answers and failures) before giving up on a pending payment. */
  maxRequests?: number
  /** Failures in a row before the page says the status could not be checked. */
  maxFailuresInRow?: number
  /** Longest pause after a failure. */
  maxBackoffMs?: number
}

/**
 * A failure that asking again may fix: no connection, a server error, a timeout or "too many requests". Any other
 * client error (the payment is not this account's, the session has ended) gives the same answer every time.
 */
export const isTransient = (err: unknown): boolean => {
  if (!isApiError(err)) return true
  return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500
}

/**
 * Asks for the payment status after the provider sends the student back, until the payment settles. One dropped
 * request is not an answer: a failure is retried with a growing pause, and only `maxFailuresInRow` failures in a row
 * stop with `unreachable`. An answer resets the count. Returns a function that stops asking.
 */
export function pollPayment<S extends { state: PaymentState }>(opts: PaymentPollOptions<S>): () => void {
  const intervalMs = opts.intervalMs ?? 3000
  const maxRequests = opts.maxRequests ?? 60
  const maxFailuresInRow = opts.maxFailuresInRow ?? 5
  const maxBackoffMs = opts.maxBackoffMs ?? 10_000
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let requests = 0
  let failuresInRow = 0

  const later = (ms: number) => { timer = setTimeout(() => void tick(), ms) }
  const giveUp = (stop: PollStop) => { stopped = true; opts.onStop(stop) }

  const tick = async () => {
    if (stopped) return
    requests += 1
    try {
      const status = await opts.fetch()
      if (stopped) return
      failuresInRow = 0
      opts.onStatus(status)
      if (status.state !== 'PENDING') { stopped = true; return }
      if (requests >= maxRequests) giveUp({ reason: 'still_pending' })
      else later(intervalMs)
    } catch (error) {
      if (stopped) return
      if (!isTransient(error)) return giveUp({ reason: 'refused', error })
      failuresInRow += 1
      if (failuresInRow >= maxFailuresInRow) return giveUp({ reason: 'unreachable', error })
      if (requests >= maxRequests) return giveUp({ reason: 'still_pending' })
      later(Math.min(intervalMs * failuresInRow, maxBackoffMs))
    }
  }

  void tick()
  return () => { stopped = true; if (timer) clearTimeout(timer) }
}
