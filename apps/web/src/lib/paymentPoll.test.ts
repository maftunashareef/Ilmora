import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { isTransient, pollPayment, type PaymentState, type PollStop } from './paymentPoll'

type S = { state: PaymentState }
const offline = () => new ApiError(0, 'network_error', 'offline')

/** A fake server: each request takes the next scripted answer (a state, or an error to throw). */
function server(script: (PaymentState | Error)[]) {
  let i = 0
  const fetch = vi.fn(async (): Promise<S> => {
    const next = script[Math.min(i++, script.length - 1)]
    if (next instanceof Error) throw next
    return { state: next }
  })
  return fetch
}

function start(script: (PaymentState | Error)[], extra: { maxRequests?: number } = {}) {
  const fetch = server(script)
  const seen: PaymentState[] = []
  const stops: PollStop[] = []
  const stop = pollPayment<S>({ fetch, onStatus: (s) => seen.push(s.state), onStop: (s) => stops.push(s), ...extra })
  return { fetch, seen, stops, stop }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('checking the payment after the provider sends the student back', () => {
  it('one dropped request is not "payment failed": it asks again and shows the paid answer', async () => {
    const { fetch, seen, stops } = start([offline(), 'PAID'])
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(seen).toEqual(['PAID'])
    expect(stops).toEqual([])
  })

  it('a few failures in a row while pending keep it asking; an answer resets the count', async () => {
    const e = offline()
    const { fetch, seen, stops } = start(['PENDING', e, e, e, e, 'PENDING', e, e, e, e, 'PAID'])
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledTimes(11)
    expect(seen).toEqual(['PENDING', 'PENDING', 'PAID'])
    expect(stops).toEqual([])
  })

  it('says the status could not be checked only after five failures in a row, and stops asking', async () => {
    const e = offline()
    const { fetch, stops } = start(['PENDING', e])
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledTimes(6)
    expect(stops).toEqual([{ reason: 'unreachable', error: e }])
  })

  it('waits longer after each failure, up to 10 seconds', async () => {
    const { fetch } = start([offline()])
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    for (const [wait, calls] of [[3000, 2], [6000, 3], [9000, 4], [10_000, 5]] as const) {
      await vi.advanceTimersByTimeAsync(wait - 1)
      expect(fetch).toHaveBeenCalledTimes(calls - 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetch).toHaveBeenCalledTimes(calls)
    }
  })

  it('a refusal that asking again cannot fix (not this account’s payment) stops at once', async () => {
    const e = new ApiError(404, 'not_found', 'Payment not found')
    const { fetch, stops } = start([e])
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(stops).toEqual([{ reason: 'refused', error: e }])
  })

  it('a cancelled or expired payment is a final answer', async () => {
    const { fetch, seen, stops } = start(['PENDING', 'EXPIRED'])
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(seen).toEqual(['PENDING', 'EXPIRED'])
    expect(stops).toEqual([])
  })

  it('a payment still pending after the last request is reported as still pending', async () => {
    const { fetch, stops } = start(['PENDING'], { maxRequests: 4 })
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(stops).toEqual([{ reason: 'still_pending' }])
  })

  it('leaving the page stops the asking', async () => {
    const { fetch, stop } = start(['PENDING'])
    await vi.advanceTimersByTimeAsync(0)
    stop()
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries no connection, server errors, timeouts and "too many requests"; not other refusals', () => {
    expect(isTransient(offline())).toBe(true)
    expect(isTransient(new ApiError(502, 'http_502', 'Bad gateway'))).toBe(true)
    expect(isTransient(new ApiError(408, 'http_408', 'Timeout'))).toBe(true)
    expect(isTransient(new ApiError(429, 'rate_limited', 'Too many'))).toBe(true)
    expect(isTransient(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransient(new ApiError(404, 'not_found', 'Not found'))).toBe(false)
    expect(isTransient(new ApiError(401, 'unauthorized', 'Session ended'))).toBe(false)
  })
})
