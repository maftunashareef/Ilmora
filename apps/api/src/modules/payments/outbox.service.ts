import { Injectable } from '@nestjs/common'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'

/** Attempts after which a failing event is left for a person to look at (Н14). */
export const OUTBOX_MAX_ATTEMPTS = 10

export interface OutboxInput { tenantId: string | null; type: string; payload: Record<string, unknown>; dedupeKey?: string; availableAt?: Date }

/**
 * Transactional outbox: side effects (receipts, notifications) are recorded in the same transaction as the
 * business change and delivered later by the worker, so a crash between the two cannot lose or duplicate them.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(tx: TransactionClient, input: OutboxInput) {
    if (input.dedupeKey) {
      const existing = await tx.outboxEvent.findUnique({ where: { dedupeKey: input.dedupeKey } })
      if (existing) return existing
    }
    return tx.outboxEvent.create({ data: { tenantId: input.tenantId, type: input.type, payload: input.payload as Prisma.InputJsonValue, dedupeKey: input.dedupeKey, availableAt: input.availableAt ?? new Date() } })
  }

  /** Claim a batch of due events with SKIP LOCKED so parallel dispatchers never process the same row. */
  async claim(limit = 50): Promise<{ id: string; tenantId: string | null; type: string; payload: Prisma.JsonValue; attempts: number }[]> {
    return this.prisma.client.$queryRawUnsafe(
      `UPDATE "OutboxEvent" SET "lockedAt" = now()
       WHERE id IN (
         SELECT id FROM "OutboxEvent"
         WHERE "processedAt" IS NULL AND "attempts" < $2 AND "availableAt" <= now() AND ("lockedAt" IS NULL OR "lockedAt" < now() - interval '5 minutes')
         ORDER BY "availableAt" ASC LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING id, "tenantId", type, payload, attempts`,
      limit,
      OUTBOX_MAX_ATTEMPTS,
    )
  }

  markDone(id: string) {
    return this.prisma.client.outboxEvent.update({ where: { id }, data: { processedAt: new Date(), lockedAt: null, lastError: null } })
  }

  /**
   * Exponential backoff with a cap; after OUTBOX_MAX_ATTEMPTS the event is no longer claimed and stays visible as failed
   * (processedAt null, attempts ≥ OUTBOX_MAX_ATTEMPTS) — it is not retried forever (Н14).
   */
  markFailed(id: string, attempts: number, error: string) {
    const delayMs = Math.min(2 ** attempts * 30_000, 6 * 3_600_000)
    return this.prisma.client.outboxEvent.update({ where: { id }, data: { attempts: attempts + 1, lastError: error.slice(0, 500), lockedAt: null, availableAt: new Date(Date.now() + delayMs) } })
  }
}
