/**
 * One-time Super Admin (owner) setup. Runs on the server with database access, never through the API.
 *
 *   npm run owner:setup -- --login <login>                 development (tsx)
 *   node dist/cli/owner-setup.js --login <login>            inside the api container
 *
 * Creates the account if the login does not exist (asks for a password on a hidden prompt), or designates the
 * existing account as the tenant's owner. Exactly one owner exists per tenant; Super Admin claims are derived
 * from that designation at sign-in, so nothing else can grant them.
 *
 * Options:
 *   --tenant <slug>     tenant to configure (default: DEFAULT_TENANT_SLUG or "ilmora")
 *   --name <text>       display name for a newly created account (default: the login)
 *   --replace           transfer ownership away from the currently configured owner
 *   --demote-others     remove PLATFORM_ADMIN/FINANCE_ADMIN from every other account and revoke their sessions
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
  if (!login) { console.error('Usage: owner-setup --login <login> [--tenant <slug>] [--name <text>] [--replace] [--demote-others] [--set-password] [--password-stdin]'); process.exit(2) }
  if (!LOGIN_RE.test(login)) throw new Error('Login must be 3–32 characters: letters, digits, dot, underscore or dash')
  const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  try {
    const slug = typeof args.tenant === 'string' ? args.tenant : process.env.DEFAULT_TENANT_SLUG ?? 'ilmora'
    const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, slug: true, ownerUserId: true } })
    if (!tenant) throw new Error(`Tenant "${slug}" does not exist (run the seed first)`)

    // 1. Report every privileged account before anything changes.
    const privileged = await prisma.user.findMany({
      where: { tenantId: tenant.id, OR: PRIVILEGED.map((r) => ({ roles: { has: r } })) },
      select: { id: true, login: true, phoneE164: true, displayName: true, roles: true, isActive: true },
      orderBy: { createdAt: 'asc' },
    })
    console.log(`Tenant ${tenant.slug}: ${privileged.length} account(s) carry privileged roles; owner = ${tenant.ownerUserId ?? 'not configured'}`)
    for (const u of privileged) {
      const marker = u.id === tenant.ownerUserId ? ' (OWNER)' : ''
      console.log(`  - ${u.id}${marker}: login=${u.login ?? '—'} phone=${mask(u.phoneE164)} roles=${u.roles.join(',')} active=${u.isActive}`)
    }

    const target = await prisma.user.findUnique({ where: { tenantId_login: { tenantId: tenant.id, login } } })
    if (tenant.ownerUserId && tenant.ownerUserId !== target?.id && !args.replace) {
      throw new Error('An owner is already configured. Re-run with --replace to transfer ownership to this login.')
    }
    if (target && !target.isActive) console.log('The account is deactivated; it will be re-activated as the owner.')

    // 2. Password: required for a new account or one without a password; optional otherwise.
    let passwordHash: string | undefined
    if (!target || !target.passwordHash || args['set-password']) {
      passwordHash = await argon2.hash(await askPassword(args['password-stdin'] === true), PASSWORD_HASH)
    }

    // 3. Apply atomically: designate, (optionally) demote others, revoke sessions whose claims change, audit.
    const now = new Date()
    const result = await prisma.$transaction(async (tx) => {
      const roles = Array.from(new Set([...(target?.roles ?? []), ...PRIVILEGED])) as Role[]
      const user = target
        ? await tx.user.update({ where: { id: target.id }, data: { roles, isActive: true, ...(passwordHash ? { passwordHash } : {}) } })
        : await tx.user.create({ data: { tenantId: tenant.id, login, passwordHash: passwordHash as string, displayName: typeof args.name === 'string' ? args.name : login, roles } })
      await tx.tenant.update({ where: { id: tenant.id }, data: { ownerUserId: user.id } })
      const demoted: string[] = []
      if (tenant.ownerUserId && tenant.ownerUserId !== user.id) {
        await tx.refreshSession.updateMany({ where: { userId: tenant.ownerUserId, revokedAt: null }, data: { revokedAt: now, revokedReason: 'owner_transferred' } })
      }
      if (args['demote-others']) {
        for (const u of privileged) {
          if (u.id === user.id) continue
          await tx.user.update({ where: { id: u.id }, data: { roles: u.roles.filter((r) => !PRIVILEGED.includes(r)) } })
          await tx.refreshSession.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: now, revokedReason: 'owner_setup_demotion' } })
          demoted.push(u.id)
        }
      }
      await tx.auditEvent.create({
        data: { tenantId: tenant.id, actorId: null, actorRoles: [], action: 'owner.setup', entityType: 'Tenant', entityId: tenant.id, before: { ownerUserId: tenant.ownerUserId }, after: { ownerUserId: user.id, demoted }, reason: 'owner-setup command' },
      })
      return { user, demoted }
    })

    console.log(`Owner configured: ${result.user.id} (login=${login}). Super Admin claims apply from the next sign-in or token refresh.`)
    const others = privileged.filter((u) => u.id !== result.user.id && !result.demoted.includes(u.id))
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
