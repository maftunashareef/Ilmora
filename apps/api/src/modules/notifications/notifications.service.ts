import { Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { LiveEvents } from './live-events.service'

export interface NotifyInput {
  tenantId: string
  userIds: string[]
  /** Dictionary key suffix: the web app renders `notif.<type>` with `params` in the reader's language. */
  type: string
  params?: Record<string, unknown>
  /** One row per (key, user): a second call with the same key for the same user is ignored. */
  dedupeKey?: string
}

export interface NotificationDto {
  id: string
  type: string
  params: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

const toDto = (n: { id: string; type: string; params: unknown; readAt: Date | null; createdAt: Date }): NotificationDto => ({
  id: n.id, type: n.type, params: (n.params ?? {}) as Record<string, unknown>, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString(),
})

/** Channel of one user's live notifications (server-sent events). */
export const userChannel = (userId: string) => `notif:${userId}`

/**
 * In-app notifications: durable rows per recipient plus a live ping on the recipient's channel. Rows can be written
 * inside the caller's transaction (then they commit with the business change); the ping is best effort either way.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(private readonly prisma: PrismaService, private readonly live: LiveEvents) {}

  /** Creates one row per distinct recipient. Returns how many rows were written (duplicates by dedupeKey are skipped). */
  async notify(input: NotifyInput, tx?: TransactionClient | PrismaService['client']): Promise<number> {
    const userIds = [...new Set(input.userIds.filter(Boolean))]
    if (userIds.length === 0) return 0
    const db = tx ?? this.prisma.client
    const params = (input.params ?? {}) as Prisma.InputJsonValue
    const rows = userIds.map((userId) => ({ tenantId: input.tenantId, userId, type: input.type, params, dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${userId}` : null }))
    const res = await db.notification.createMany({ data: rows, skipDuplicates: true })
    if (res.count > 0) {
      const at = new Date().toISOString()
      for (const userId of userIds) void this.live.publish(userChannel(userId), { type: 'notification', notification: { type: input.type, params: input.params ?? {}, createdAt: at } })
    }
    return res.count
  }

  /** Newest first; `before` (ISO instant) pages backwards. */
  async list(userId: string, q: { before?: string; limit?: number }): Promise<{ items: NotificationDto[]; unreadCount: number }> {
    const limit = Math.min(100, Math.max(1, q.limit ?? 30))
    const before = q.before ? new Date(q.before) : null
    const [rows, unreadCount] = await Promise.all([
      this.prisma.client.notification.findMany({ where: { userId, ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}) }, orderBy: { createdAt: 'desc' }, take: limit }),
      this.prisma.client.notification.count({ where: { userId, readAt: null } }),
    ])
    return { items: rows.map(toDto), unreadCount }
  }

  async markRead(userId: string, input: { ids?: string[]; all?: boolean }): Promise<{ unreadCount: number }> {
    const now = new Date()
    if (input.all) await this.prisma.client.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } })
    else if (input.ids?.length) await this.prisma.client.notification.updateMany({ where: { userId, id: { in: input.ids }, readAt: null }, data: { readAt: now } })
    return { unreadCount: await this.prisma.client.notification.count({ where: { userId, readAt: null } }) }
  }

  // ───────── recipient look-ups (ids only; the caller decides the event) ─────────

  /** Center administrators of one center (active accounts). */
  async centerAdminIds(tenantId: string, centerId: string, db: TransactionClient | PrismaService['client'] = this.prisma.client): Promise<string[]> {
    const rows = await db.user.findMany({ where: { tenantId, centerId, isActive: true, roles: { has: 'CENTER_ADMIN' } }, select: { id: true } })
    return rows.map((r) => r.id)
  }

  /** The login account behind a teacher profile, when the teacher has one. */
  async teacherUserId(teacherProfileId: string, db: TransactionClient | PrismaService['client'] = this.prisma.client): Promise<string | null> {
    const t = await db.teacherProfile.findFirst({ where: { id: teacherProfileId }, select: { userId: true } })
    return t?.userId ?? null
  }

  /** Students with an ACTIVE enrollment in the group. */
  async groupStudentIds(groupId: string, db: TransactionClient | PrismaService['client'] = this.prisma.client): Promise<string[]> {
    const rows = await db.enrollment.findMany({ where: { groupId, status: 'ACTIVE' }, select: { studentId: true } })
    return rows.map((r) => r.studentId)
  }

  /** Super Admins (owner accounts) of the tenant. */
  async ownerIds(tenantId: string, db: TransactionClient | PrismaService['client'] = this.prisma.client): Promise<string[]> {
    const rows = await db.user.findMany({ where: { tenantId, isOwner: true, isActive: true }, select: { id: true } })
    return rows.map((r) => r.id)
  }

  /** Teacher account + center administrators of a course, deduplicated. */
  async courseStaffIds(tenantId: string, course: { teacherId: string; centerId: string }, db: TransactionClient | PrismaService['client'] = this.prisma.client): Promise<string[]> {
    const [teacher, admins] = await Promise.all([this.teacherUserId(course.teacherId, db), this.centerAdminIds(tenantId, course.centerId, db)])
    return [...new Set([teacher, ...admins].filter((x): x is string => !!x))]
  }

  stream(userId: string) {
    return this.live.stream(userChannel(userId))
  }

  /** Never lets a notification failure break the business operation that triggered it. */
  async safely(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      this.logger.warn(`${label}: ${(err as Error).message}`)
    }
  }
}
