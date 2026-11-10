import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleData, type MfaChallengeDto } from '@ilmora/shared'
import { api } from '../lib/api'
import type { AuthUser, InitialData } from './useStore'
import { createIlmoraStore, isMfaChallenge } from './useStore'

vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api: vi.fn() }))
const apiMock = vi.mocked(api)

const initialMock: InitialData = {
  lang: 'uz',
  site: Object.assign({}, sampleData.site, { version: 1 }) as never,
  catalog: {
    centers: sampleData.centers as never,
    categories: sampleData.categories as never,
    teachers: sampleData.teachers as never,
    subjects: sampleData.subjects as never,
    courses: sampleData.courses as never,
  },
}

const ministry: AuthUser = {
  id: 'u-ministry', login: 'vazirlik', phone: null, displayName: 'Vazirlik', district: null, preferredLang: 'uz', reminders: false,
  roles: ['MINISTRY'], centerId: null, teacherProfileId: null, offerAcceptedAt: '2026-11-01T00:00:00Z', offerVersion: '1.0',
  consentAt: '2026-11-01T00:00:00Z', marketing: false,
} as AuthUser
const challenge: MfaChallengeDto = { mfaRequired: true, stage: 'setup', challenge: 'c'.repeat(40), expiresInSeconds: 300 }

beforeEach(() => apiMock.mockReset())

describe('sign-in with the authenticator code (ministry, Super Admins)', () => {
  it('a password accepted with the authenticator step opens no session yet', async () => {
    apiMock.mockResolvedValueOnce(challenge)
    const store = createIlmoraStore(initialMock)
    const result = await store.getState().login('vazirlik', 'password-1')
    expect(isMfaChallenge(result)).toBe(true)
    expect(store.getState().auth.status).not.toBe('authenticated')
  })

  it('the first code links the app, opens the session and hands over the recovery codes', async () => {
    apiMock.mockResolvedValueOnce({ accessToken: 'token', user: ministry, recoveryCodes: ['abcd-efgh', 'ijkl-mnop'] })
    const store = createIlmoraStore(initialMock)
    const { user, recoveryCodes } = await store.getState().mfaConfirm(challenge.challenge, '123456')
    expect(apiMock).toHaveBeenCalledWith('/auth/mfa/confirm', expect.objectContaining({ method: 'POST', body: { challenge: challenge.challenge, code: '123456' }, credentials: true }))
    expect(user.roles).toContain('MINISTRY')
    expect(recoveryCodes).toEqual(['abcd-efgh', 'ijkl-mnop'])
    expect(store.getState().auth.status).toBe('authenticated')
  })

  it('a code from the app (or a recovery code) opens the session on later sign-ins', async () => {
    apiMock.mockResolvedValueOnce({ accessToken: 'token', user: ministry })
    const store = createIlmoraStore(initialMock)
    await store.getState().mfaVerify('v'.repeat(40), 'abcd-efgh')
    expect(apiMock).toHaveBeenCalledWith('/auth/mfa/verify', expect.objectContaining({ body: { challenge: 'v'.repeat(40), code: 'abcd-efgh' } }))
    expect(store.getState().auth.status).toBe('authenticated')
  })

  it('only an answer marked mfaRequired is the authenticator step', () => {
    expect(isMfaChallenge(challenge)).toBe(true)
    expect(isMfaChallenge({ accessToken: 't', user: ministry })).toBe(false)
    expect(isMfaChallenge(null)).toBe(false)
  })
})

describe('the temporary password of a ministry account', () => {
  it('changing the password sends the current and the new one and takes the new session', async () => {
    apiMock.mockResolvedValueOnce({ accessToken: 'fresh', user: { ...ministry, passwordChangeRequired: false } })
    const store = createIlmoraStore(initialMock)
    const user = await store.getState().changePassword('UNvGHQemjpsuXYwX', 'Yangi-parol-2026')
    expect(apiMock).toHaveBeenCalledWith('/auth/password', expect.objectContaining({ method: 'POST', body: { currentPassword: 'UNvGHQemjpsuXYwX', newPassword: 'Yangi-parol-2026' }, credentials: true }))
    expect(user.passwordChangeRequired).toBe(false)
    expect(store.getState().auth.status).toBe('authenticated')
    expect(store.getState().auth.user?.passwordChangeRequired).toBe(false)
  })

  it('the flag from the sign-in stays on the account until the password is changed', async () => {
    apiMock.mockResolvedValueOnce({ accessToken: 'token', user: { ...ministry, passwordChangeRequired: true } })
    const store = createIlmoraStore(initialMock)
    await store.getState().mfaVerify('v'.repeat(40), '123456')
    expect(store.getState().auth.user?.passwordChangeRequired).toBe(true)
  })
})

describe('403 password_change_required from any request', () => {
  it('marks the signed-in account, so the change screen shows', async () => {
    const real = await vi.importActual<typeof import('../lib/api')>('../lib/api')
    // The store registers its handler in the browser only.
    vi.stubGlobal('window', globalThis)
    try {
      apiMock.mockResolvedValueOnce({ accessToken: 'token', user: ministry })
      const store = createIlmoraStore(initialMock)
      await store.getState().mfaVerify('v'.repeat(40), '123456')
      expect(store.getState().auth.user?.passwordChangeRequired).toBeFalsy()
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'password_change_required', message: 'x' } }), { status: 403 })))
      await expect(real.api('/ministry/stats')).rejects.toMatchObject({ code: 'password_change_required' })
      expect(store.getState().auth.status).toBe('authenticated')
      expect(store.getState().auth.user?.passwordChangeRequired).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      real.setPasswordChangeRequiredHandler(null)
    }
  })
})
