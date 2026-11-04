import { describe, expect, it, vi } from 'vitest'
import { normalizeUzPhone, formatUzPhone } from '@ilmora/shared'
import { AuthService } from '../src/modules/auth/auth.service'
import { AccountService } from '../src/modules/auth/account.service'
import { testEnv } from './helpers'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import type { TokenService } from '../src/modules/auth/token.service'
import type { AuditService } from '../src/modules/audit/audit.service'
import type { RedisService } from '../src/infra/redis/redis.service'
import { notificationsStub } from './stubs'

describe('Auth extended unit tests (Google OAuth & Registration Security)', () => {
  const env = testEnv({
    GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    NODE_ENV: 'test',
  })

  const dummyPrisma = {} as unknown as PrismaService
  const dummyOtp = {} as never
  const dummyTokens = {} as unknown as TokenService
  const dummyAudit = {} as unknown as AuditService
  let capturedProfile: unknown = null

  const dummyAccounts = {
    loginWithGoogle: async (_tenantId: string, profile: unknown, _meta: unknown) => {
      capturedProfile = profile
      return {
        accessToken: 'mock-access-token',
        expiresInSeconds: 900,
        refresh: { raw: 'mock-refresh-token', expiresAt: new Date(Date.now() + 86400000) },
        user: { id: 'test-user-id', displayName: (profile as { displayName: string }).displayName },
      }
    },
  } as unknown as AccountService

  const authService = new AuthService(dummyPrisma, dummyOtp, dummyTokens, dummyAudit, dummyAccounts, env)

  describe('Phone normalization & format parity', () => {
    it('normalizes local 9-digit format to E.164 with +998', () => {
      const p = normalizeUzPhone('90 123 45 67')
      expect(p.ok).toBe(true)
      if (p.ok) {
        expect(p.e164).toBe('+998901234567')
        expect(formatUzPhone(p.e164)).toBe('+998 90 123 45 67')
      }
    })

    it('normalizes international input with spaces, dashes, parentheses', () => {
      const p = normalizeUzPhone('+998 (99) 876-54-32')
      expect(p.ok).toBe(true)
      if (p.ok) {
        expect(p.e164).toBe('+998998765432')
        expect(formatUzPhone(p.e164)).toBe('+998 99 876 54 32')
      }
    })

    it('rejects invalid or too short numbers', () => {
      expect(normalizeUzPhone('12345').ok).toBe(false)
      expect(normalizeUzPhone('+1234567890').ok).toBe(false)
    })
  })

  describe('Google OAuth verification', () => {
    it('authenticates valid dev mock token and passes verified profile to AccountService', async () => {
      const result = await authService.authenticateGoogle('ilmora', {
        idToken: 'mock-google-token:gid-12345:anvar%40example.com:Anvar%20Qodirov',
        role: 'STUDENT',
      }, { ip: '127.0.0.1', userAgent: 'vitest' })

      expect(result.accessToken).toBe('mock-access-token')
      expect(capturedProfile).toEqual({
        googleId: 'gid-12345',
        email: 'anvar@example.com',
        emailVerified: true,
        displayName: 'Anvar Qodirov',
        role: 'STUDENT',
      })
    })

    it('rejects request when neither idToken nor code is provided', async () => {
      await expect(
        authService.authenticateGoogle('ilmora', {}, { ip: '127.0.0.1', userAgent: 'vitest' })
      ).rejects.toMatchObject({ code: 'missing_google_credential' })
    })

    it('rejects code exchange when Google OAuth client credentials are unconfigured', async () => {
      const unconfiguredEnv = testEnv({
        GOOGLE_CLIENT_ID: undefined,
        GOOGLE_CLIENT_SECRET: undefined,
      })
      const unconfiguredAuth = new AuthService(dummyPrisma, dummyOtp, dummyTokens, dummyAudit, dummyAccounts, unconfiguredEnv)

      await expect(
        unconfiguredAuth.authenticateGoogle('ilmora', { code: 'auth-code-123' }, { ip: '127.0.0.1', userAgent: 'vitest' })
      ).rejects.toMatchObject({ code: 'google_unconfigured' })
    })

    it('rejects Google account when email is unverified', async () => {
      const accountService = new AccountService(
        {} as unknown as PrismaService,
        {} as unknown as TokenService,
        {} as unknown as AuditService,
        {} as unknown as RedisService,
        notificationsStub,
        env,
      )

      await expect(
        accountService.loginWithGoogle(
          'tenant-1',
          { googleId: 'gid-1', email: 'unverified@example.com', emailVerified: false, displayName: 'Unverified' },
          {},
        ),
      ).rejects.toMatchObject({ code: 'unverified_email' })
    })

    it('authenticates valid dev mock token and passes verified profile with role and lang to AccountService', async () => {
      const result = await authService.authenticateGoogle('ilmora', {
        idToken: 'mock-google-token:gid-12345:anvar%40example.com:Anvar%20Qodirov',
        role: 'TEACHER',
        lang: 'ru',
      }, { ip: '127.0.0.1', userAgent: 'vitest' })

      expect(result.accessToken).toBe('mock-access-token')
      expect(capturedProfile).toEqual({
        googleId: 'gid-12345',
        email: 'anvar@example.com',
        emailVerified: true,
        displayName: 'Anvar Qodirov',
        role: 'TEACHER',
        lang: 'ru',
      })
    })

    it('does not hijack existing password account when Google email prefix matches password user login', async () => {
      let createdUserData: any = null
      const mockPrisma = {
        client: {
          user: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'existing-password-user',
              login: 'john',
              passwordHash: '$argon2id$...',
              roles: ['STUDENT'],
              isActive: true,
            }),
            findUnique: vi.fn().mockImplementation(({ where }: any) => {
              if (where.tenantId_login?.login === 'john') return Promise.resolve({ id: 'existing-password-user' })
              return Promise.resolve(null)
            }),
            create: vi.fn().mockImplementation(({ data }: any) => {
              createdUserData = data
              return Promise.resolve({
                id: 'new-google-user',
                roles: data.roles,
                tenantId: data.tenantId,
                login: data.login,
                displayName: data.displayName,
                preferredLang: data.preferredLang,
                centerId: null,
                teacherProfile: null,
              })
            }),
          },
          tenant: {
            findUnique: vi.fn().mockResolvedValue({ ownerUserId: 'other-owner' }),
          },
          $transaction: vi.fn(async (cb: any) => cb(mockPrisma.client)),
        },
      }

      const mockTokens = {
        signAccess: vi.fn().mockResolvedValue('jwt-token'),
        issueRefresh: vi.fn().mockResolvedValue({ raw: 'refresh-token', expiresAt: new Date() }),
      } as unknown as TokenService

      const mockAudit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService

      const accountService = new AccountService(
        mockPrisma as unknown as PrismaService,
        mockTokens,
        mockAudit,
        {} as unknown as RedisService,
        notificationsStub,
        env,
      )

      const result = await accountService.loginWithGoogle(
        'tenant-1',
        { googleId: 'gid-999', email: 'john@gmail.com', emailVerified: true, displayName: 'John Doe', role: 'STUDENT', lang: 'en' },
        {},
      )

      expect(result.user.id).toBe('new-google-user')
      expect(createdUserData.login).toBe('john_2')
      expect(createdUserData.preferredLang).toBe('en')
      expect(createdUserData.googleId).toBe('gid-999')
    })

    // Regression: accounts used to be matched by the part of the e-mail before "@", so anvar@mail.ru (another Google
    // account) signed into the Google-created account of anvar@gmail.com.
    const googleAccountService = (existing: Record<string, unknown> | null) => {
      const created: Record<string, unknown>[] = []
      const client = {
        user: {
          findFirst: vi.fn().mockResolvedValue({ id: 'victim', login: 'anvar', passwordHash: null, roles: ['STUDENT'], isActive: true }),
          findUnique: vi.fn().mockImplementation(({ where }: any) => {
            if (where.tenantId_googleId) return Promise.resolve(where.tenantId_googleId.googleId === existing?.googleId ? existing : null)
            if (where.tenantId_login?.login === 'anvar') return Promise.resolve({ id: 'victim' })
            return Promise.resolve(null)
          }),
          create: vi.fn().mockImplementation(({ data }: any) => {
            created.push(data)
            return Promise.resolve({ id: 'new-google-user', roles: data.roles, tenantId: data.tenantId, login: data.login, displayName: data.displayName, isOwner: false, centerId: null, teacherProfile: null })
          }),
          update: vi.fn().mockImplementation(({ where }: any) => Promise.resolve({ ...existing, id: where.id })),
        },
        $transaction: vi.fn(async (cb: any) => cb(client)),
      }
      const tokens = { signAccess: vi.fn().mockResolvedValue('jwt'), issueRefresh: vi.fn().mockResolvedValue({ raw: 'r', expiresAt: new Date() }) } as unknown as TokenService
      const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService
      const service = new AccountService({ client } as unknown as PrismaService, tokens, audit, {} as unknown as RedisService, notificationsStub, env)
      return { service, client, created }
    }

    it('does not sign a different Google account into an account with the same e-mail local part', async () => {
      const { service, created } = googleAccountService({ id: 'victim', googleId: 'gid-victim', login: 'anvar', roles: ['STUDENT'], isActive: true, isOwner: false, centerId: null, teacherProfile: null })
      const result = await service.loginWithGoogle('tenant-1', { googleId: 'gid-attacker', email: 'anvar@mail.ru', emailVerified: true, displayName: 'Attacker' }, {})
      expect(result.user.id).toBe('new-google-user')
      expect(created).toHaveLength(1)
      expect(created[0].googleId).toBe('gid-attacker')
      expect(created[0].login).not.toBe('anvar')
    })

    it('signs the same Google account back into its own account by Google id', async () => {
      const { service, created } = googleAccountService({ id: 'victim', googleId: 'gid-victim', login: 'anvar', roles: ['STUDENT'], isActive: true, isOwner: false, centerId: null, teacherProfile: null })
      const result = await service.loginWithGoogle('tenant-1', { googleId: 'gid-victim', email: 'anvar@gmail.com', emailVerified: true, displayName: 'Anvar' }, {})
      expect(result.user.id).toBe('victim')
      expect(created).toHaveLength(0)
    })
  })

  describe('Account Service Security & Isolation', () => {
    it('normalizes login to lowercase and rejects invalid characters or length', () => {
      const accountService = new AccountService(
        {} as unknown as PrismaService,
        {} as unknown as TokenService,
        {} as unknown as AuditService,
        {} as unknown as RedisService,
        notificationsStub,
        env,
      )

      expect(accountService.normalizeLogin('  Ali_Vali  ')).toBe('ali_vali')
      expect(accountService.normalizeLogin('Student-01')).toBe('student-01')

      expect(() => accountService.normalizeLogin('ab')).toThrow() // too short
      expect(() => accountService.normalizeLogin('a'.repeat(33))).toThrow() // too long
      expect(() => accountService.normalizeLogin('_invalid')).toThrow() // cannot start with symbol
      expect(() => accountService.normalizeLogin('invalid@user')).toThrow() // invalid character
    })

    it('ensures public registration never grants PLATFORM_ADMIN', async () => {
      const mockPrisma = {
        client: {
          tenant: {
            findUnique: vi.fn().mockResolvedValue({ ownerUserId: 'actual-superadmin-owner' }),
          },
        },
      }

      const accountService = new AccountService(
        mockPrisma as unknown as PrismaService,
        {} as unknown as TokenService,
        {} as unknown as AuditService,
        {} as unknown as RedisService,
        notificationsStub,
        env,
      )

      // Even if database row had PLATFORM_ADMIN in roles column:
      const effective = await accountService.effectiveRoles({
        isOwner: false,
        roles: ['STUDENT', 'PLATFORM_ADMIN'] as import('../src/generated/prisma/enums').Role[],
      })

      expect(effective).toEqual(['STUDENT'])
      expect(effective).not.toContain('PLATFORM_ADMIN')
    })

    it('grants PLATFORM_ADMIN and FINANCE_ADMIN when isOwner is true', async () => {
      const mockPrisma = {
        client: {},
      }

      const accountService = new AccountService(
        mockPrisma as unknown as PrismaService,
        {} as unknown as TokenService,
        {} as unknown as AuditService,
        {} as unknown as RedisService,
        notificationsStub,
        env,
      )

      const ownerRoles = await accountService.effectiveRoles({
        isOwner: true,
        roles: ['STUDENT'],
      })

      expect(ownerRoles).toContain('PLATFORM_ADMIN')
      expect(ownerRoles).toContain('FINANCE_ADMIN')
    })

    it('rejects registration when login is already taken (duplicate-account handling)', async () => {
      const mockPrisma = {
        client: {
          user: {
            findUnique: vi.fn().mockResolvedValue({ id: 'existing-user-id' }),
          },
        },
      }

      const accountService = new AccountService(
        mockPrisma as unknown as PrismaService,
        {} as unknown as TokenService,
        {} as unknown as AuditService,
        {} as unknown as RedisService,
        notificationsStub,
        env,
      )

      await expect(
        accountService.register(
          'tenant-1',
          { role: 'STUDENT', login: 'existinguser', password: 'securepassword123' },
          {},
        ),
      ).rejects.toMatchObject({
        code: 'login_taken',
      })
    })

    it('never binds a self-asserted phone to the account at password registration', async () => {
      // The phone typed on the sign-up form is not proven to belong to the registrant (no SMS code), so it must not land
      // on the account's unique phoneE164 — otherwise anyone could squat a victim's number and capture their SMS sign-in.
      const created: Record<string, unknown> = {}
      const client: Record<string, unknown> = {
        user: {
          findUnique: vi.fn().mockResolvedValue(null), // login is free
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(created, data)
            return { id: 'u1', tenantId: 'tenant-1', roles: ['STUDENT'], centerId: null, teacherProfile: null, isOwner: false, ...data }
          }),
        },
        $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
      }

      const accountService = new AccountService(
        { client } as unknown as PrismaService,
        { signAccess: async () => 'access', issueRefresh: async () => ({ raw: 'r', expiresAt: new Date(Date.now() + 86400000) }) } as unknown as TokenService,
        { record: vi.fn(async () => undefined) } as unknown as AuditService,
        {} as unknown as RedisService,
        notificationsStub,
        env,
      )

      const result = await accountService.register(
        'tenant-1',
        { role: 'STUDENT', login: 'newuser123', password: 'securepassword123', phone: '+998901234567' },
        {},
      )

      expect(result.accessToken).toBeDefined()
      expect(created.phoneE164).toBeNull() // the unverified phone is dropped, not stored on the user
    })
  })
})
