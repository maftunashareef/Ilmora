/**
 * One-off removal of test accounts on a hosted environment where the database is not reachable from outside.
 * Reads CLEANUP_LOGINS (comma-separated logins); each matching account is deactivated and soft-deleted together
 * with its teacher profile, and its sessions are revoked. Idempotent: unknown or already removed logins are skipped.
 *
 *   CLEANUP_LOGINS=a.b,c.d node dist/cli/cleanup-accounts.js
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { resolve } from 'node:path'
import { PrismaClient } from '../generated/prisma/client'

try {
  process.loadEnvFile?.(resolve(__dirname, '..', '..', '.env'))
} catch {
  /* environment comes from the process */
}

async function main() {
  const logins = (process.env.CLEANUP_LOGINS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (!logins.length) { console.log('[cleanup] CLEANUP_LOGINS is empty, nothing to do'); return }
  const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  try {
    const now = new Date()
    for (const login of logins) {
      const user = await prisma.user.findFirst({ where: { login, deletedAt: null }, include: { teacherProfile: { select: { id: true } } } })
      if (!user) { console.log(`[cleanup] ${login}: not found or already removed`); continue }
      await prisma.$transaction(async (tx) => {
        if (user.teacherProfile) await tx.teacherProfile.update({ where: { id: user.teacherProfile.id }, data: { deletedAt: now, channelActive: false }, includeDeleted: true } as never)
        await tx.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now, revokedReason: 'cleanup' } })
        await tx.user.update({ where: { id: user.id }, data: { isActive: false, deletedAt: now } })
        await tx.auditEvent.create({ data: { tenantId: user.tenantId, actorId: null, actorRoles: [], action: 'user.cleanup', entityType: 'User', entityId: user.id, after: { login, reason: 'test account removed by cleanup command' } } })
      })
      console.log(`[cleanup] ${login}: deactivated and soft-deleted`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err: Error) => {
  console.error(err.message)
  process.exit(1)
})
