import { Prisma } from '../../generated/prisma/client'
import { TenantContext } from '../tenancy/tenant-context'

/** Models that carry `tenantId` and are automatically scoped to the current tenant. */
export const TENANT_SCOPED_MODELS = new Set<string>([
  'User', 'RefreshSession', 'OtpCode', 'Center', 'Category', 'TeacherProfile', 'Subject', 'Course', 'Group', 'Package',
  'Video', 'Playlist', 'Resource', 'SavedItem', 'Subscription', 'Enrollment', 'LessonSession', 'AttendanceRecord',
  'Payment', 'PaymentTransaction', 'LedgerJournal', 'LedgerEntry', 'Receipt', 'AuditEvent', 'SmsMessage', 'CenterInquiry', 'Notification',
])

/** Models with `deletedAt`: deletes become soft deletes and normal reads exclude deleted rows. */
export const SOFT_DELETE_MODELS = new Set<string>([
  'Tenant', 'User', 'Center', 'Category', 'TeacherProfile', 'Subject', 'Course', 'Group', 'Video', 'Playlist', 'Resource',
])

type AnyArgs = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown; includeDeleted?: boolean; hardDelete?: boolean }

const READ_OPS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy'])
const WRITE_WHERE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert'])

function tenantFilter(model: string): string | null {
  if (!TENANT_SCOPED_MODELS.has(model)) return null
  if (TenantContext.isSystem()) return TenantContext.current()?.tenantId ?? null
  return TenantContext.requireTenantId()
}

function withTenantWhere(args: AnyArgs, tenantId: string): AnyArgs {
  return { ...args, where: { ...(args.where ?? {}), tenantId } }
}

function withTenantData(data: unknown, tenantId: string): unknown {
  // The context tenant must come LAST so it always wins: if it were first, a caller-supplied `tenantId` in the
  // payload would override it via the spread and write the row into another organization (Ж12 — fail closed).
  if (Array.isArray(data)) return data.map((d) => ({ ...(d as object), tenantId }))
  if (data && typeof data === 'object') return { ...(data as object), tenantId }
  return data
}

/**
 * Query extension enforcing:
 *  1. Tenant isolation — every read/write on a tenant-scoped model is filtered by the current tenant
 *     (or fails when no tenant context exists). Creates get the tenant injected.
 *  2. Soft deletion — `delete` → `update { deletedAt }`, reads exclude deleted rows unless `includeDeleted: true`.
 */
export const tenantAndSoftDeleteExtension = Prisma.defineExtension({
  name: 'tenant-and-soft-delete',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const a = (args ?? {}) as AnyArgs
        const includeDeleted = a.includeDeleted === true
        const hardDelete = a.hardDelete === true
        delete a.includeDeleted
        delete a.hardDelete

        let next: AnyArgs = a
        const tenantId = tenantFilter(model)

        if (tenantId) {
          if (READ_OPS.has(operation) || WRITE_WHERE_OPS.has(operation)) next = withTenantWhere(next, tenantId)
          if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') next = { ...next, data: withTenantData(next.data, tenantId) }
          if (operation === 'upsert') next = { ...next, create: withTenantData((next as { create?: unknown }).create, tenantId) }
        } else if (TENANT_SCOPED_MODELS.has(model) && !TenantContext.isSystem()) {
          throw new Error(`Tenant-scoped model ${model} accessed without a tenant context`)
        }

        if (SOFT_DELETE_MODELS.has(model)) {
          if (!includeDeleted && (READ_OPS.has(operation) || operation === 'updateMany')) {
            next = { ...next, where: { deletedAt: null, ...(next.where ?? {}) } }
          }
          if (!hardDelete && operation === 'delete') {
            return (query as unknown as (a: unknown) => Promise<unknown>)({ ...next, data: { deletedAt: new Date() } }).catch(() => {
              throw new Error(`Soft delete for ${model} must go through repository.softDelete()`)
            })
          }
          if (!hardDelete && operation === 'deleteMany') {
            throw new Error(`deleteMany on soft-deletable model ${model} is not allowed; use updateMany with deletedAt`)
          }
        }

        return query(next as never)
      },
    },
  },
})
