import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

const respond = (body: string, status: number) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))

afterEach(() => vi.unstubAllGlobals())

describe('api()', () => {
  it('returns the parsed JSON body of a successful response', async () => {
    respond('{"ok":true}', 200)
    await expect(api('/ping')).resolves.toEqual({ ok: true })
  })

  it('throws the API error carried by a JSON error body', async () => {
    respond('{"error":{"code":"not_found","message":"No such course"}}', 404)
    await expect(api('/courses/x')).rejects.toMatchObject({ status: 404, code: 'not_found', message: 'No such course' })
  })

  it('reports a gateway error page as the server being unreachable, not as a JSON syntax error', async () => {
    for (const [body, status] of [['Internal Server Error', 500], ['<html><body>502 Bad Gateway</body></html>', 502]] as const) {
      respond(body, status)
      const err = await api('/ping').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ApiError)
      expect(err).toMatchObject({ status, code: 'network_error' })
    }
  })
})
