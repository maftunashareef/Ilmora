import { Injectable } from '@nestjs/common'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'

export interface AuditInput {
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
  reason?: string
  /** Pass the transaction client to record the audit row atomically with the change. */
  tx?: TransactionClient
  tenantId?: string
}

const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))) as Prisma.InputJsonValue)

/** Who changed what, when and why — for payments, attendance, roles and content moderation. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    const client = input.tx ?? this.prisma.client
    await client.auditEvent.create({ data: this.row(input) })
  }

  /** Many rows of one request in one insert (e.g. every student card a company opened in a list). */
  async recordMany(inputs: Omit<AuditInput, 'tx'>[]): Promise<void> {
    if (inputs.length) await this.prisma.client.auditEvent.createMany({ data: inputs.map((i) => this.row(i)) })
  }

  private row(input: AuditInput): Prisma.AuditEventUncheckedCreateInput {
    const ctx = TenantContext.current()
    const tenantId = input.tenantId ?? ctx?.tenantId
    if (!tenantId) throw new Error('Audit record requires a tenant')
    return {
        tenantId,
        actorId: ctx?.actor?.id ?? null,
        actorRoles: ctx?.actor?.roles ?? [],
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: toJson(input.before),
        after: toJson(input.after),
        reason: input.reason,
        ip: ctx?.ip,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
    }
  }
}
