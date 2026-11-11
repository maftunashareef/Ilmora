/**
 * Callbacks that did not prove they come from the provider (wrong password, bad signature, unknown order) are logged
 * without their body and at most `perMinute` times a minute per address — so nobody can fill the disk through the
 * public callback URLs (security review 10.11 №11). Per process; the provider's own traffic is never limited.
 */
export class CallbackLogBudget {
  private readonly seen = new Map<string, { count: number; until: number }>()
  constructor(private readonly perMinute = 20) {}

  allow(ip: string | undefined, now = Date.now()): boolean {
    const key = ip ?? 'unknown'
    const rec = this.seen.get(key)
    if (!rec || rec.until <= now) {
      if (this.seen.size > 10_000) this.seen.clear()
      this.seen.set(key, { count: 1, until: now + 60_000 })
      return true
    }
    rec.count += 1
    return rec.count <= this.perMinute
  }
}

/** Logs kept: the provider's own calls 90 days (disputes, reconciliation), unproven ones a week. */
export const CALLBACK_LOG_DAYS = 90
export const UNPROVEN_CALLBACK_LOG_DAYS = 7
