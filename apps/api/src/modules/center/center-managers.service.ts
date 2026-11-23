import { Injectable } from '@nestjs/common'
import argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { AppError } from '../../common/errors'
import { Role } from '../../generated/prisma/enums'
import { forgetAccountState } from '../../common/request-context.middleware'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { AccountService, PASSWORD_HASH } from '../auth/account.service'
import { TokenService } from '../auth/token.service'
import type { CenterManagerInput } from './center-managers.schemas'

/** A center keeps a handful of managers; more is a sign of misuse, not of a big center. */
export const CENTER_MANAGERS_MAX = 10
/** The only roles a center's manager account may hold; an account with any other role is not the center's to manage. */
const MANAGER_ROLES: Role[] = ['CENTER_MANAGER', 'TEACHER', 'STUDENT']
/**
 * A center's manager accounts: CENTER_MANAGER and nothing beyond MANAGER_ROLES, never an owner. Otherwise the center admin
 * could block or reset the password of an owner, a finance admin, a ministry, institution or company account that was
 * also given the manager role.
 */
const MANAGER_WHERE = { roles: { has: 'CENTER_MANAGER' as const }, isOwner: false, NOT: { roles: { hasSome: Object.values(Role).filter((r) => !MANAGER_ROLES.includes(r)) } } }

const SELECT = { id: true, login: true, displayName: true, isActive: true, passwordIssuedAt: true, lastLoginAt: true, createdAt: true } as const
type Row = { id: string; login: string | null; displayName: string; isActive: boolean; passwordIssuedAt: Date | null; lastLoginAt: Date | null; createdAt: Date }
const toDto = (u: Row) => ({
  id: u.id, login: u.login ?? '', name: u.displayName, active: u.isActive, passwordToChange: u.passwordIssuedAt !== null,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
})
/** 16 characters without look-alikes (0/O, 1/l/I): typed once, changed at the first sign-in. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const temporaryPassword = () => Array.from(randomBytes(16), (b) => ALPHABET[b % ALPHABET.length]).join('')

/**
 * Managers of a center (проверка безопасности 19.11, №15; Тимур, 23.11): the center's administrator creates a separate
 * account for the manager — a login and a temporary password shown once, to be changed at the first sign-in. Only new
 * accounts (Шерзод, 23.11): no existing account gets the role here, so no one finds out which logins exist and no one's
 * account gains access to children's data without them. The Super Admin does the same from the center's page (support).
 * A manager is switched off, not deleted: the audit log keeps who did what.
 */
@Injectable()
export class CenterManagersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: AccountService,
    private readonly tokens: TokenService,
  ) {}

  private async own(tenantId: string, actor: RequestActor) {
    if (!actor.centerId) throw AppError.forbidden('Your account is not linked to a center', { code: 'center_required' })
    const center = await this.prisma.client.center.findFirst({ where: { tenantId, id: actor.centerId, deletedAt: null } })
    if (!center) throw AppError.notFound('Center')
    return center
  }

  /** New accounts with access to students' data: only an approved center makes them (the Super Admin always can). */
  private assertApproved(center: { status: string }, actor: RequestActor) {
    if (center.status !== 'ACTIVE' && !actor.roles.includes('PLATFORM_ADMIN')) throw AppError.forbidden('The center is not approved yet', { code: 'center_not_approved' })
  }

  private async manager(tenantId: string, centerId: string, id: string) {
    const user = await this.prisma.client.user.findFirst({ where: { tenantId, id, centerId, ...MANAGER_WHERE }, select: SELECT })
    if (!user) throw AppError.notFound('Manager')
    return user
  }

  async list(tenantId: string, actor: RequestActor) {
    const center = await this.own(tenantId, actor)
    const rows = await this.prisma.client.user.findMany({ where: { tenantId, centerId: center.id, ...MANAGER_WHERE }, orderBy: { createdAt: 'asc' }, select: SELECT })
    return { items: rows.map(toDto), max: CENTER_MANAGERS_MAX }
  }

  async create(tenantId: string, actor: RequestActor, input: CenterManagerInput) {
    const center = await this.own(tenantId, actor)
    this.assertApproved(center, actor)
    const count = await this.prisma.client.user.count({ where: { tenantId, centerId: center.id, ...MANAGER_WHERE } })
    if (count >= CENTER_MANAGERS_MAX) throw AppError.invalid('center_managers_limit', `A center has at most ${CENTER_MANAGERS_MAX} managers`, { max: CENTER_MANAGERS_MAX })
    const login = this.accounts.normalizeLogin(input.login)
    const password = temporaryPassword()
    let row: Row
    try {
      row = await this.prisma.client.user.create({
        data: { tenantId, login, passwordHash: await argon2.hash(password, PASSWORD_HASH), passwordIssuedAt: new Date(), displayName: input.name, roles: ['CENTER_MANAGER'], centerId: center.id },
        select: SELECT,
      })
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw AppError.conflict('login_taken', 'This login is already in use')
      throw err
    }
    await this.audit.record({ action: 'center.manager_create', entityType: 'User', entityId: row.id, after: { centerId: center.id, login, roles: ['CENTER_MANAGER'] } })
    return { manager: toDto(row), temporaryPassword: password }
  }

  /** Switched off: no sign-in, every open session ends at once. Switched on again: signs in with the same password. */
  async setActive(tenantId: string, actor: RequestActor, id: string, active: boolean) {
    const center = await this.own(tenantId, actor)
    const before = await this.manager(tenantId, center.id, id)
    if (before.isActive === active) return toDto(before)
    const row = await this.prisma.client.user.update({ where: { id }, data: { isActive: active }, select: SELECT })
    if (!active) await this.tokens.revokeAllForUser(tenantId, id, 'disabled-by-center')
    forgetAccountState(id)
    await this.audit.record({ action: active ? 'center.manager_enable' : 'center.manager_disable', entityType: 'User', entityId: id, after: { centerId: center.id } })
    return toDto(row)
  }

  /** A new temporary password, shown once; the sessions end and it is changed at the next sign-in. */
  async resetPassword(tenantId: string, actor: RequestActor, id: string) {
    const center = await this.own(tenantId, actor)
    this.assertApproved(center, actor)
    await this.manager(tenantId, center.id, id)
    const password = temporaryPassword()
    const row = await this.prisma.client.user.update({ where: { id }, data: { passwordHash: await argon2.hash(password, PASSWORD_HASH), passwordIssuedAt: new Date() }, select: SELECT })
    await this.tokens.revokeAllForUser(tenantId, id, 'password-reset-by-center')
    forgetAccountState(id)
    await this.audit.record({ action: 'center.manager_reset_password', entityType: 'User', entityId: id, after: { centerId: center.id } })
    return { manager: toDto(row), temporaryPassword: password }
  }
}
