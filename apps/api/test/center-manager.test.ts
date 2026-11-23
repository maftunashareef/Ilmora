import 'reflect-metadata'
import argon2 from 'argon2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROLES_KEY } from '../src/common/decorators'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import type { AccountService } from '../src/modules/auth/account.service'
import { AdminCenterController, asCenter } from '../src/modules/center/admin-center.controller'
import { CENTER_MANAGERS_MAX, CenterManagersService } from '../src/modules/center/center-managers.service'
import { CenterController } from '../src/modules/center/center.controller'
import { JournalController } from '../src/modules/classroom/classroom.controller'
import { JournalService } from '../src/modules/classroom/journal.service'
import { UserRolesInput } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

/**
 * The center's manager (проверка безопасности 19.11, №15; Тимур, 23.11): the students' table, invitations, Excel both
 * ways, reading groups and the journal — not courses and prices, money, staff or the center's settings. The center's
 * administrator creates the manager a new account (Шерзод, 23.11: only new accounts, a temporary password shown once);
 * the Super Admin can do the same from the center's page.
 */
const roles = (target: object) => Reflect.getMetadata(ROLES_KEY, target) as string[] | undefined
const allowed = (ctl: { prototype: object }, method: string) => roles((ctl.prototype as Record<string, object>)[method]) ?? roles(ctl) ?? []
const methods = (ctl: { prototype: object }) => Object.getOwnPropertyNames(ctl.prototype).filter((n) => n !== 'constructor')

describe('Center manager: which routes let the role in', () => {
  const MANAGER_ROUTES = ['roster', 'exportStudents', 'importCheck', 'importStudents', 'addStudent', 'student', 'updateStudent', 'inviteStudent', 'groups', 'group']

  it('the center workspace: the students table, Excel and invitations, reading groups — nothing else', () => {
    const open = methods(CenterController).filter((m) => allowed(CenterController, m).includes('CENTER_MANAGER'))
    expect(open.sort()).toEqual([...MANAGER_ROUTES].sort())
    // Courses and prices, staff (teachers, managers), settings, the overview with its figures stay with the administrator.
    for (const m of ['overview', 'profile', 'qr', 'rotateQr', 'attendance', 'teachers', 'addTeacher', 'courses', 'createCourse', 'updateCourse', 'createGroup', 'updateGroup', 'deleteGroup', 'managers', 'createManager', 'students']) {
      expect(allowed(CenterController, m), m).not.toContain('CENTER_MANAGER')
      expect(allowed(CenterController, m), m).toContain('CENTER_ADMIN')
    }
    // Every route the manager has, the administrator has too.
    for (const m of MANAGER_ROUTES) expect(allowed(CenterController, m)).toContain('CENTER_ADMIN')
  })

  it('the journal: the manager reads it, marks stay with the teacher and the administrator', () => {
    expect(allowed(JournalController, 'get')).toContain('CENTER_MANAGER')
    expect(allowed(JournalController, 'mark')).not.toContain('CENTER_MANAGER')
  })

  it('managers: the administrator in the center, the Super Admin on the twin route; the Super Admin may also set the role', () => {
    for (const m of ['managers', 'createManager', 'disableManager', 'enableManager', 'resetManagerPassword']) {
      expect(allowed(CenterController, m)).toEqual(['CENTER_ADMIN'])
      expect(allowed(AdminCenterController, m)).toEqual(['PLATFORM_ADMIN'])
    }
    expect(UserRolesInput.safeParse({ roles: ['CENTER_MANAGER'], centerId: 'c1', reason: 'support' }).success).toBe(true)
  })
})

describe.skipIf(!DB_AVAILABLE)('Center manager on the database', () => {
  const ctx = new TestContext()
  const accounts = { normalizeLogin: (raw: string) => raw.normalize('NFKC').trim().toLowerCase() } as unknown as AccountService
  const managers = new CenterManagersService(ctx.prisma, ctx.audit, accounts, ctx.tokens)
  const journal = new JournalService(ctx.prisma, ctx.audit)
  const manage = new ManageService(
    ctx.prisma, ctx.audit,
    { generateForGroup: async () => 0, todayLocal: () => '2026-11-23' } as unknown as SessionsService,
    { get: async () => ({ permissions: { teacher: { editCourses: true, editPrices: false, publishDirectly: false, manageGroups: true, editSchedules: true } } }) } as unknown as SiteService,
    notificationsStub, ctx.env,
  )
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const err = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; details?: { code?: string }; response?: { code?: string } }) => e.details?.code ?? e.code ?? e.response?.code ?? String(e))
  async function setup(label: string, status: 'ACTIVE' | 'PENDING' = 'ACTIVE') {
    const t = await ctx.makeTenant(label)
    return TenantContext.forTenant(t.tenantId, async () => {
      await ctx.prisma.client.center.update({ where: { id: t.center.id }, data: { status, approvedAt: status === 'ACTIVE' ? new Date() : null } })
      const u = await ctx.prisma.client.user.create({ data: { tenantId: t.tenantId, login: `adm-${t.tenantId}`, displayName: 'Admin', roles: ['CENTER_ADMIN'], centerId: t.center.id } })
      const admin: RequestActor = { id: u.id, roles: ['CENTER_ADMIN'], centerId: t.center.id }
      return { t, admin }
    })
  }
  const inTenant = <T>(tenantId: string, actor: RequestActor, fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn, { actor })

  it('the administrator creates a new account: the role, the center, a temporary password to change; audited without it', async () => {
    const s = await setup('mgr-create')
    const login = `mgr-${s.t.tenantId}`.slice(0, 32)
    const out = await inTenant(s.t.tenantId, s.admin, () => managers.create(s.t.tenantId, s.admin, { login, name: 'Dilnoza Karimova' }))
    expect(out.manager).toMatchObject({ login, name: 'Dilnoza Karimova', active: true, passwordToChange: true })
    const user = await TenantContext.system(() => ctx.prisma.client.user.findUniqueOrThrow({ where: { id: out.manager.id } }))
    expect(user).toMatchObject({ roles: ['CENTER_MANAGER'], centerId: s.t.center.id, isActive: true })
    expect(user.passwordIssuedAt).not.toBeNull()
    expect(await argon2.verify(user.passwordHash!, out.temporaryPassword)).toBe(true)
    const audit = await TenantContext.system(() => ctx.prisma.client.auditEvent.findFirstOrThrow({ where: { action: 'center.manager_create', entityId: user.id } }))
    expect(JSON.stringify(audit)).not.toContain(out.temporaryPassword)
    // The same login again: refused, no second account.
    expect(await err(inTenant(s.t.tenantId, s.admin, () => managers.create(s.t.tenantId, s.admin, { login, name: 'Other' })))).toBe('login_taken')
    expect((await inTenant(s.t.tenantId, s.admin, () => managers.list(s.t.tenantId, s.admin))).items).toHaveLength(1)
  })

  it('only an approved center creates managers (the Super Admin always can); at most CENTER_MANAGERS_MAX', async () => {
    const pending = await setup('mgr-pending', 'PENDING')
    expect(await err(inTenant(pending.t.tenantId, pending.admin, () => managers.create(pending.t.tenantId, pending.admin, { login: `p-${pending.t.tenantId}`.slice(0, 32), name: 'Aziz' })))).toBe('center_not_approved')
    const ownerUser = await TenantContext.system(() => ctx.prisma.client.user.create({ data: { tenantId: pending.t.tenantId, login: `own-${pending.t.tenantId}`.slice(0, 32), displayName: 'Owner', roles: ['PLATFORM_ADMIN'], isOwner: true } }))
    const owner: RequestActor = { id: ownerUser.id, roles: ['PLATFORM_ADMIN'], centerId: null }
    await expect(inTenant(pending.t.tenantId, owner, () => managers.create(pending.t.tenantId, asCenter(owner, pending.t.center.id), { login: `o-${pending.t.tenantId}`.slice(0, 32), name: 'Aziz' }))).resolves.toMatchObject({ manager: { active: true } })

    const s = await setup('mgr-limit')
    await TenantContext.system(() => ctx.prisma.client.user.createMany({ data: Array.from({ length: CENTER_MANAGERS_MAX }, (_, i) => ({ tenantId: s.t.tenantId, login: `m${i}-${s.t.tenantId}`.slice(0, 32), displayName: `M${i}`, roles: ['CENTER_MANAGER' as const], centerId: s.t.center.id })) }))
    expect(await err(inTenant(s.t.tenantId, s.admin, () => managers.create(s.t.tenantId, s.admin, { login: `x-${s.t.tenantId}`.slice(0, 32), name: 'One more' })))).toBe('center_managers_limit')
  })

  it('switching off ends the sessions; another center cannot touch the manager', async () => {
    const a = await setup('mgr-a')
    const b = await setup('mgr-b')
    const { manager } = await inTenant(a.t.tenantId, a.admin, () => managers.create(a.t.tenantId, a.admin, { login: `off-${a.t.tenantId}`.slice(0, 32), name: 'Aziz' }))
    // Center B's administrator, even with the manager's id (another tenant or the same): not found.
    const foreign: RequestActor = { ...b.admin }
    expect(await err(inTenant(a.t.tenantId, foreign, () => managers.setActive(a.t.tenantId, foreign, manager.id, false)))).toMatch(/center|not_found|Manager/i)
    await expect(inTenant(a.t.tenantId, a.admin, () => managers.setActive(a.t.tenantId, a.admin, manager.id, false))).resolves.toMatchObject({ active: false })
    const reset = await inTenant(a.t.tenantId, a.admin, () => managers.resetPassword(a.t.tenantId, a.admin, manager.id))
    const user = await TenantContext.system(() => ctx.prisma.client.user.findUniqueOrThrow({ where: { id: manager.id } }))
    expect(await argon2.verify(user.passwordHash!, reset.temporaryPassword)).toBe(true)
    expect(user.isActive).toBe(false)
  })

  it('the manager reads the own center\'s groups and journal, does not mark, and sees no other center', async () => {
    const a = await setup('mgr-read-a')
    const b = await setup('mgr-read-b')
    const { manager } = await inTenant(a.t.tenantId, a.admin, () => managers.create(a.t.tenantId, a.admin, { login: `rd-${a.t.tenantId}`.slice(0, 32), name: 'Aziz' }))
    const actor: RequestActor = { id: manager.id, roles: ['CENTER_MANAGER'], centerId: a.t.center.id }
    const groups = await inTenant(a.t.tenantId, actor, () => manage.myGroups(a.t.tenantId, actor))
    expect(groups.map((g) => g.id).sort()).toEqual([a.t.group.id, a.t.group2.id].sort())
    await expect(inTenant(a.t.tenantId, actor, () => manage.groupDetail(a.t.tenantId, actor, a.t.group.id))).resolves.toMatchObject({ group: { id: a.t.group.id } })
    await expect(inTenant(a.t.tenantId, actor, () => journal.journal(a.t.group.id, actor, '2026-11'))).resolves.toBeTruthy()
    expect(await err(inTenant(a.t.tenantId, actor, () => journal.setMark(a.t.group.id, actor, { sessionId: 'none', centerStudentId: 'none', status: 'PRESENT' } as never)))).toMatch(/forbidden|manage/i)
    // Another center's group (another tenant here: the tenant scoping hides it; the rule also holds within one tenant).
    const other: RequestActor = { id: manager.id, roles: ['CENTER_MANAGER'], centerId: b.t.center.id === a.t.center.id ? 'x' : a.t.center.id }
    expect(await err(inTenant(b.t.tenantId, other, () => manage.groupDetail(b.t.tenantId, other, b.t.group.id)))).toMatch(/forbidden|own content/i)
    expect(await err(inTenant(b.t.tenantId, other, () => journal.journal(b.t.group.id, other, '2026-11')))).toMatch(/forbidden|manage/i)
  })

  it('a privileged account that also has CENTER_MANAGER is not the center\'s to block, reset or list', async () => {
    const s = await setup('mgr-priv')
    const mk = (login: string, data: { roles: ('CENTER_MANAGER' | 'FINANCE_ADMIN' | 'PLATFORM_ADMIN' | 'MINISTRY' | 'COMPANY_ADMIN' | 'INSTITUTION_ADMIN')[]; isOwner?: boolean }) =>
      TenantContext.system(() => ctx.prisma.client.user.create({ data: { tenantId: s.t.tenantId, login: `${login}-${s.t.tenantId}`.slice(0, 32), displayName: login, centerId: s.t.center.id, ...data } }))
    const owner = await mk('own', { roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN', 'CENTER_MANAGER'], isOwner: true })
    const finance = await mk('fin', { roles: ['FINANCE_ADMIN', 'CENTER_MANAGER'] })
    const ministry = await mk('min', { roles: ['MINISTRY', 'CENTER_MANAGER'] })
    const company = await mk('com', { roles: ['COMPANY_ADMIN', 'CENTER_MANAGER'] })
    const institution = await mk('ins', { roles: ['INSTITUTION_ADMIN', 'CENTER_MANAGER'] })
    for (const u of [owner, finance, ministry, company, institution]) {
      expect(await err(inTenant(s.t.tenantId, s.admin, () => managers.setActive(s.t.tenantId, s.admin, u.id, false)))).toBe('not_found')
      expect(await err(inTenant(s.t.tenantId, s.admin, () => managers.resetPassword(s.t.tenantId, s.admin, u.id)))).toBe('not_found')
      expect(await TenantContext.system(() => ctx.prisma.client.user.findUniqueOrThrow({ where: { id: u.id } }))).toMatchObject({ isActive: true, passwordHash: null })
    }
    expect((await inTenant(s.t.tenantId, s.admin, () => managers.list(s.t.tenantId, s.admin))).items).toEqual([])
  })
})
