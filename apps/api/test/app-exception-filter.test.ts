import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { type ArgumentsHost, Logger } from '@nestjs/common'
import { Prisma } from '../src/generated/prisma/client'
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

describe('5xx in the server log: no values from a Prisma query (security review 19.11, №8)', () => {
  /** What the filter writes to the log for an exception, as one JSON string. */
  const logged = (exception: unknown) => {
    const calls: unknown[] = []
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation((entry: unknown) => { calls.push(entry) })
    try { answer(exception) } finally { spy.mockRestore() }
    expect(calls, 'one log line per 500').toHaveLength(1)
    return JSON.stringify(calls[0], (_k, v: unknown) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v))
  }
  const PHONE = '+998901234567'
  const NAME = 'Aziz Karimov'

  it('a known Prisma error: the code and the model, not its message or meta', () => {
    const err = new Prisma.PrismaClientKnownRequestError(`Unique constraint failed: phone ${PHONE}, name ${NAME}`, {
      code: 'P2034', clientVersion: 'test', meta: { modelName: 'CenterStudent', target: ['phoneE164'], value: PHONE, fullName: NAME },
    })
    const line = logged(err)
    expect(line).toContain('P2034')
    expect(line).toContain('CenterStudent')
    expect(line).not.toContain(PHONE)
    expect(line).not.toContain(NAME)
  })

  it('a Prisma validation error (its message repeats the query): only the type', () => {
    const line = logged(new Prisma.PrismaClientValidationError(`Invalid value for phoneE164: "${PHONE}"`, { clientVersion: 'test' }))
    expect(line).toContain('PrismaClientValidationError')
    expect(line).not.toContain(PHONE)
  })

  it('any other error keeps its message and stack', () => {
    const line = logged(new Error('boom in the worker'))
    expect(line).toContain('boom in the worker')
    expect(line).toContain('stack')
  })
})
