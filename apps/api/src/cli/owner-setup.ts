/**
 * Super Admin (owner) setup. Runs on the server with database access, never through the API.
 *
 *   npm run owner:setup -- --login <login>                 development (tsx)
 *   node dist/cli/owner-setup.js --login <login>            inside the api or migrator container
 *
 * Creates the account if the login does not exist (asks for a password on a hidden prompt), or designates the
 * existing account as an owner. A tenant may have several owners (User.isOwner); Super Admin claims are derived
 * from that flag at sign-in and refresh, so nothing else can grant them.
 *
 * Options:
 *   --tenant <slug>     tenant to configure (default: DEFAULT_TENANT_SLUG or "ilmora")
 *   --name <text>       display name for a newly created account (default: the login)
 *   --add               add this login as another owner when owners already exist
 *   --replace           make this login the only owner (the others lose Super Admin and are signed out)
 *   --remove            take Super Admin away from this login and sign it out (never the last owner)
 *   --demote-others     remove PLATFORM_ADMIN/FINANCE_ADMIN from every non-owner account and revoke their sessions
 *   --set-password      change the password of an existing account
 *   --password-stdin    read the password from stdin (first line) instead of the hidden prompt
 */
import { PrismaPg } from '@prisma/adapter-pg'
import argon2 from 'argon2'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { PrismaClient } from '../generated/prisma/client'
import type { Role } from '../generated/prisma/enums'

try {
  process.loadEnvFile?.(resolve(__dirname, '..', '..', '.env'))
} catch {
  /* environment comes from the process */
}

const PASSWORD_HASH = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/
const OWNER_MIN_PASSWORD = 12
const PRIVILEGED: Role[] = ['PLATFORM_ADMIN', 'FINANCE_ADMIN']

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { out[key] = next; i++ } else out[key] = true
  }
  return out
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((done) => {
    const muted = new Writable({ write(_chunk, _enc, cb) { cb() } })
    process.stdout.write(prompt)
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true })
    rl.question('', (answer) => { rl.close(); process.stdout.write('\n'); done(answer) })
  })
}

function readStdinLine(): Promise<string> {
  return new Promise((done) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => done(data.split(/\r?\n/)[0] ?? ''))
  })
}

async function askPassword(fromStdin: boolean): Promise<string> {
  const pw = fromStdin ? await readStdinLine() : await readHidden(`Owner password (min ${OWNER_MIN_PASSWORD} characters, not echoed): `)
  if (pw.length < OWNER_MIN_PASSWORD || pw.length > 128) throw new Error(`The owner password must be ${OWNER_MIN_PASSWORD}–128 characters`)
  if (!fromStdin) {
    const again = await readHidden('Repeat the password: ')
    if (again !== pw) throw new Error('Passwords do not match')
  }
  return pw
}

const mask = (phone: string | null) => (phone ? phone.replace(/(\+998\d{2})\d{5}(\d{2})/, '$1*****$2') : '—')

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const rawLogin = typeof args.login === 'string' ? args.login : ''
  const login = rawLogin.normalize('NFKC').trim().toLowerCase()
  if (!login) { console.error('Usage: owner-setup --login <login> [--tenant <slug>] [--name <text>] [--add | --replace | --remove] [--demote-others] [--set-password] [--password-stdin]'); process.exit(2) }
  if (!LOGIN_RE.test(login)) throw new Error('Login must be 3–32 characters: letters, digits, dot, underscore or dash')
  if ([args.add, args.replace, args.remove].filter(Boolean).length > 1) throw new Error('Use only one of --add, --replace, --remove')
  const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  try {
    const slug = typeof args.tenant === 'string' ? args.tenant : process.env.DEFAULT_TENANT_SLUG ?? 'ilmora'
    const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, slug: true } })
    if (!tenant) throw new Error(`Tenant "${slug}" does not exist (run the seed first)`)

    // 1. Report every owner and privileged account before anything changes.
    const privileged = await prisma.user.findMany({
      where: { tenantId: tenant.id, OR: [{ isOwner: true }, ...PRIVILEGED.map((r) => ({ roles: { has: r } }))] },
      select: { id: true, login: true, phoneE164: true, displayName: true, roles: true, isActive: true, isOwner: true },
      orderBy: { createdAt: 'asc' },
    })
    const owners = privileged.filter((u) => u.isOwner)
    const ownerNames = (list: { id: string; login: string | null }[]) => list.map((u) => u.login ?? u.id).join(', ')
    console.log(`Tenant ${tenant.slug}: owners = ${owners.length ? ownerNames(owners) : 'not configured'}; ${privileged.length} account(s) are owners or carry privileged roles`)
    for (const u of privileged) {
      const marker = u.isOwner ? ' (OWNER)' : ''
      console.log(`  - ${u.id}${marker}: login=${u.login ?? '—'} phone=${mask(u.phoneE164)} roles=${u.roles.join(',')} active=${u.isActive}`)
    }

    const target = await prisma.user.findUnique({ where: { tenantId_login: { tenantId: tenant.id, login } } })
    const now = new Date()

    // 2a. --remove: Super Admin is taken away; the account itself stays.
    if (args.remove) {
      if (!target?.isOwner) throw new Error(`"${login}" is not an owner`)
      if (owners.length <= 1) throw new Error('Refusing to remove the last owner: add another one first (--add)')
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: target.id }, data: { isOwner: false, roles: target.roles.filter((r) => !PRIVILEGED.includes(r)) } })
        await tx.refreshSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now, revokedReason: 'owner_removed' } })
        await tx.auditEvent.create({
          data: { tenantId: tenant.id, actorId: null, actorRoles: [], action: 'owner.remove', entityType: 'User', entityId: target.id, before: { owners: owners.map((o) => o.id) }, after: { owners: owners.filter((o) => o.id !== target.id).map((o) => o.id) }, reason: 'owner-setup command' },
        })
      })
      console.log(`Owner removed: ${target.id} (login=${login}) is no longer Super Admin and was signed out. Owners now: ${ownerNames(owners.filter((o) => o.id !== target.id))}`)
      return
    }

    if (owners.length && !target?.isOwner && !args.add && !args.replace) {
      throw new Error(`Owners are already configured (${ownerNames(owners)}). Re-run with --add to add this login as another Super Admin, or --replace to make it the only owner.`)
    }
    if (target && !target.isActive) console.log('The account is deactivated; it will be re-activated as an owner.')

    // 2b. Password: required for a new account or one without a password; optional otherwise.
    let passwordHash: string | undefined
    if (!target || !target.passwordHash || args['set-password']) {
      passwordHash = await argon2.hash(await askPassword(args['password-stdin'] === true), PASSWORD_HASH)
    }

    // 3. Apply atomically: designate, (optionally) replace or demote others, revoke sessions whose claims change, audit.
    const result = await prisma.$transaction(async (tx) => {
      const roles = Array.from(new Set([...(target?.roles ?? []), ...PRIVILEGED])) as Role[]
      const user = target
        ? await tx.user.update({ where: { id: target.id }, data: { roles, isActive: true, isOwner: true, ...(passwordHash ? { passwordHash } : {}) } })
        : await tx.user.create({ data: { tenantId: tenant.id, login, passwordHash: passwordHash as string, displayName: typeof args.name === 'string' ? args.name : login, roles, isOwner: true } })
      const replaced: string[] = []
      if (args.replace) {
        for (const o of owners) {
          if (o.id === user.id) continue
          await tx.user.update({ where: { id: o.id }, data: { isOwner: false, roles: o.roles.filter((r) => !PRIVILEGED.includes(r)) } })
          await tx.refreshSession.updateMany({ where: { userId: o.id, revokedAt: null }, data: { revokedAt: now, revokedReason: 'owner_transferred' } })
          replaced.push(o.id)
        }
      }
      const ownersAfter = [...owners.filter((o) => !replaced.includes(o.id) && o.id !== user.id).map((o) => o.id), user.id]
      const demoted: string[] = []
      if (args['demote-others']) {
        for (const u of privileged) {
          if (ownersAfter.includes(u.id) || replaced.includes(u.id)) continue
          await tx.user.update({ where: { id: u.id }, data: { roles: u.roles.filter((r) => !PRIVILEGED.includes(r)) } })
          await tx.refreshSession.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: now, revokedReason: 'owner_setup_demotion' } })
          demoted.push(u.id)
        }
      }
      await tx.auditEvent.create({
        data: { tenantId: tenant.id, actorId: null, actorRoles: [], action: 'owner.setup', entityType: 'Tenant', entityId: tenant.id, before: { owners: owners.map((o) => o.id) }, after: { owners: ownersAfter, replaced, demoted }, reason: 'owner-setup command' },
      })
      return { user, ownersAfter, replaced, demoted }
    })

    console.log(`Owner configured: ${result.user.id} (login=${login}). Super Admin claims apply from the next sign-in or token refresh.`)
    console.log(`Owners now: ${result.ownersAfter.length}`)
    if (result.replaced.length) console.log(`No longer owners (signed out): ${result.replaced.join(', ')}`)
    const others = privileged.filter((u) => !result.ownersAfter.includes(u.id) && !result.replaced.includes(u.id) && !result.demoted.includes(u.id))
    if (others.length) console.log(`${others.length} other account(s) still carry privileged roles in the database; they do NOT receive Super Admin claims. Re-run with --demote-others to clear the roles and revoke their sessions.`)
    if (result.demoted.length) console.log(`Demoted and signed out: ${result.demoted.join(', ')}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err: Error) => {
  console.error(err.message)
  process.exit(1)
})
