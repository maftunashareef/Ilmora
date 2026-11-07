import { Controller, Get, Res } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Response } from 'express'
import { Public } from '../../common/decorators'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { RedisService } from '../../infra/redis/redis.service'

/**
 * Liveness: the process answers. Readiness: database and Redis respond (Docker health checks, release smoke checks).
 * These routes sit outside the API prefix and the rate limiter.
 */
@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  @Get()
  @Get('live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) }
  }

  @Get('ready')
  async ready(@Res() res: Response) {
    const checks: Record<string, 'ok' | 'fail'> = { database: 'fail', redis: 'fail' }
    const [db, redis] = await Promise.allSettled([withTimeout(this.prisma.ping(), 3_000), withTimeout(this.redis.ping(), 3_000)])
    if (db.status === 'fulfilled' && db.value) checks.database = 'ok'
    if (redis.status === 'fulfilled' && redis.value) checks.redis = 'ok'
    const ok = Object.values(checks).every((v) => v === 'ok')
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'degraded', checks })
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}
