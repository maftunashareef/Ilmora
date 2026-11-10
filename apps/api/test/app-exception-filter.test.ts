import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ArgumentsHost } from '@nestjs/common'
import { AppExceptionFilter } from '../src/common/filters/app-exception.filter'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/** What the filter answers for an exception: status and body, as the client would see them. */
const answer = (exception: unknown) => {
  const out: { status?: number; body?: { error: { code: string } } } = {}
  const res = { status: (s: number) => ((out.status = s), res), json: (b: never) => ((out.body = b), res), setHeader: () => res }
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ headers: {}, originalUrl: '/x' }) }) } as unknown as ArgumentsHost
  new AppExceptionFilter().catch(exception, host)
  return out
}

describe.skipIf(!DB_AVAILABLE)('NUL in an id, a search or a name (security review №48)', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('is a 400 for the client, not a 500', async () => {
    const err = await TenantContext.system(() => ctx.prisma.client.institution.findFirst({ where: { id: 'a\u0000b' } })).then(() => null, (e: unknown) => e)
    expect(err).toMatchObject({ code: 'P2039' })
    expect(answer(err)).toMatchObject({ status: 400, body: { error: { code: 'validation_failed' } } })
    expect(answer(new Error('boom'))).toMatchObject({ status: 500, body: { error: { code: 'internal_error' } } })
  })
})
