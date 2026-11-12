import { Injectable } from '@nestjs/common'
import type { MinistryAccountCreatedDto, MinistryAccountDto } from '@ilmora/shared'
import argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { AppError } from '../../common/errors'
import { forgetAccountState } from '../../common/request-context.middleware'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { AccountService, PASSWORD_HASH } from '../auth/account.service'
import { MfaService } from '../auth/mfa.service'
import { TokenService } from '../auth/token.service'
import type { MinistryAccountInput, MinistryAccountPatch } from './ministry.schemas'

const SELECT = { id: true, login: true, displayName: true, jobTitle: true, email: true, isActive: true, totpEnabledAt: true, lastLoginAt: true, createdAt: true } as const
type Row = { id: string; login: string | null; displayName: string; jobTitle: string | null; email: string | null; isActive: boolean; totpEnabledAt: Date | null; lastLoginAt: Date | null; createdAt: Date }
const toDto = (u: Row): MinistryAccountDto => ({
  id: u.id, login: u.login ?? '', name: u.displayName, jobTitle: u.jobTitle, email: u.email, active: u.isActive,
  appLinked: u.totpEnabledAt !== null, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
})
/** 16 characters from an alphabet without look-alikes (0/O, 1/l/I): ~94 bits, typed once and changed later. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const temporaryPassword = () => Array.from(randomBytes(16), (b) => ALPHABET[b % ALPHABET.length]).join('')

/**
 * Ministry accounts (ТЗ 4.4): no self-registration — only the Super Admin creates them. The role MINISTRY is granted
 * here and nowhere else. The first sign-in links the authenticator app; the temporary password is shown once.
 */
@Injectable()
export class MinistryAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: AccountService,
    private readonly mfa: MfaService,
    private readonly tokens: TokenService,
  ) {}

  async list(): Promise<MinistryAccountDto[]> {
    const rows = await this.prisma.client.user.findMany({ where: { roles: { has: 'MINISTRY' } }, orderBy: { createdAt: 'asc' }, select: SELECT })
    return rows.map(toDto)
  }

  async create(tenantId: string, input: MinistryAccountInput): Promise<MinistryAccountCreatedDto> {
    const login = this.accounts.normalizeLogin(input.login)
    const password = temporaryPassword()
    let row: Row
    try {
      row = await this.prisma.client.user.create({
        data: { tenantId, login, passwordHash: await argon2.hash(password, PASSWORD_HASH), passwordIssuedAt: new Date(), displayName: input.name, jobTitle: input.jobTitle ?? null, email: input.email ?? null, roles: ['MINISTRY'] },
        select: SELECT,
      })
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw AppError.conflict('login_taken', 'This login is already in use')
      throw err
    }
    await this.audit.record({ action: 'ministry.account.create', entityType: 'User', entityId: row.id, after: { login, name: input.name, roles: ['MINISTRY'] } })
    return { account: toDto(row), temporaryPassword: password }
  }

  async update(id: string, input: MinistryAccountPatch): Promise<MinistryAccountDto> {
    const before = await this.ministryAccount(id)
    const data = {
      ...(input.name !== undefined ? { displayName: input.name } : {}),
      ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
    }
    const row = await this.prisma.client.user.update({ where: { id }, data, select: SELECT })
    await this.audit.record({ action: 'ministry.account.update', entityType: 'User', entityId: id, before: { name: before.displayName, jobTitle: before.jobTitle, email: before.email }, after: data })
    return toDto(row)
  }

  /** Disabled: no sign-in, every open session ends at once. */
  async setActive(tenantId: string, id: string, active: boolean): Promise<MinistryAccountDto> {
    await this.ministryAccount(id)
    const row = await this.prisma.client.user.update({ where: { id }, data: { isActive: active }, select: SELECT })
    if (!active) await this.tokens.revokeAllForUser(tenantId, id, 'disabled-by-admin')
    forgetAccountState(id)
    await this.audit.record({ action: active ? 'ministry.account.enable' : 'ministry.account.disable', entityType: 'User', entityId: id })
    return toDto(row)
  }

  /** A new temporary password (shown once); the sessions end. */
  async resetPassword(tenantId: string, id: string): Promise<MinistryAccountCreatedDto> {
    await this.ministryAccount(id)
    const password = temporaryPassword()
    const row = await this.prisma.client.user.update({ where: { id }, data: { passwordHash: await argon2.hash(password, PASSWORD_HASH), passwordIssuedAt: new Date() }, select: SELECT })
    await this.tokens.revokeAllForUser(tenantId, id, 'password-reset-by-admin')
    forgetAccountState(id)
    await this.audit.record({ action: 'ministry.account.reset_password', entityType: 'User', entityId: id })
    return { account: toDto(row), temporaryPassword: password }
  }

  /**
   * «Сбросить пароль» for any account (security review 10.11 №4): a temporary password, shown once; the sessions end
   * and the owner must change it at the next sign-in (`passwordIssuedAt`). Not one's own, not another Super Admin's —
   * those go through the owner-setup command on the server.
   */
  async resetAccountPassword(tenantId: string, actor: RequestActor, id: string): Promise<{ temporaryPassword: string }> {
    if (id === actor.id) throw AppError.forbidden('Change your own password in your profile')
    const user = await this.prisma.client.user.findFirst({ where: { id }, select: { id: true, isOwner: true, login: true } })
    if (!user) throw AppError.notFound('Account')
    if (user.isOwner) throw AppError.forbidden('A Super Admin password is reset on the server')
    if (!user.login) throw AppError.invalid('no_login', 'This account signs in by SMS only; it has no login to use a password with')
    const password = temporaryPassword()
    await this.prisma.client.user.update({ where: { id }, data: { passwordHash: await argon2.hash(password, PASSWORD_HASH), passwordIssuedAt: new Date() } })
    await this.tokens.revokeAllForUser(tenantId, id, 'password-reset-by-admin')
    forgetAccountState(id)
    await this.audit.record({ action: 'account.reset_password', entityType: 'User', entityId: id })
    return { temporaryPassword: password }
  }

  /**
   * Unlinks the authenticator app (lost phone): the next sign-in starts from the QR code; the sessions end. Works for a
   * ministry account and for another Super Admin — never for oneself (that would let a stolen session drop the factor).
   */
  async resetSecondFactor(tenantId: string, actor: RequestActor, id: string): Promise<void> {
    if (id === actor.id) throw AppError.forbidden('Another Super Admin resets your second factor')
    const user = await this.prisma.client.user.findFirst({ where: { id }, select: { id: true, roles: true, isOwner: true } })
    if (!user || !(user.roles.includes('MINISTRY') || user.isOwner)) throw AppError.notFound('Account')
    await this.mfa.reset(id, tenantId)
    await this.tokens.revokeAllForUser(tenantId, id, 'mfa-reset-by-admin')
  }

  private async ministryAccount(id: string) {
    const user = await this.prisma.client.user.findFirst({ where: { id, roles: { has: 'MINISTRY' } }, select: SELECT })
    if (!user) throw AppError.notFound('Ministry account')
    return user
  }
}
