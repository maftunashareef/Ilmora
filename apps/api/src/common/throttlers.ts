import type { ThrottlerOptions } from '@nestjs/throttler'
import type { Env } from '../config/env'
import { isAuthThrottled, isSessionThrottled } from './decorators'

/** The API's request limits (core.module.ts); the tracker of each comes from AppThrottlerGuard unless set here. */
export const throttlers = (env: Env): ThrottlerOptions[] => [
  { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_DEFAULT_PER_MINUTE },
  // Strict limit only for routes marked @AuthThrottle(); without skipIf it would count every request in the API.
  { name: 'auth', ttl: 60_000, limit: env.RATE_LIMIT_AUTH_PER_MINUTE, blockDuration: 5 * 60_000, skipIf: (ctx) => !isAuthThrottled(ctx) },
  // The session refresh is counted per session by «auth»; per address only this wide limit, against bulk guessing of
  // refresh values. No block: a busy classroom recovers within the minute (security review 10.11 №19).
  { name: 'refreshIp', ttl: 60_000, limit: env.RATE_LIMIT_REFRESH_PER_IP_MINUTE, skipIf: (ctx) => !isSessionThrottled(ctx), getTracker: (req) => `ip:${(req as { ip?: string }).ip ?? 'unknown'}` },
]
