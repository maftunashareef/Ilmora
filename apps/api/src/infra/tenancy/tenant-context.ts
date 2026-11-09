import { AsyncLocalStorage } from 'node:async_hooks'
import type { Role } from '../../generated/prisma/enums'

export interface RequestActor {
  id: string
  roles: Role[]
  centerId?: string | null
  teacherProfileId?: string | null
}

export interface TenantContextValue {
  tenantId: string | null
  /** System mode (jobs spanning tenants, seeding, provider callbacks before the tenant is known). */
  system: boolean
  actor?: RequestActor
  requestId?: string
  ip?: string
  userAgent?: string
}

/**
 * Per-request / per-job tenant context carried through async calls.
 * The Prisma extension reads it to scope every query; services read it for auditing.
 */
export class TenantContext {
  private static readonly als = new AsyncLocalStorage<TenantContextValue>()

  static run<T>(value: TenantContextValue, fn: () => T): T {
    // Prisma queries are lazy thenables: awaiting them here keeps the store alive until they execute,
    // even when the callback returns the promise without awaiting it.
    return TenantContext.als.run(value, () => settle(fn()))
  }

  static current(): TenantContextValue | undefined {
    return TenantContext.als.getStore()
  }

  /** Tenant for the current call, or throws — tenant-scoped data is never read without one (fail closed). */
  static requireTenantId(): string {
    const ctx = TenantContext.als.getStore()
    if (!ctx?.tenantId) throw new Error('Tenant context is missing for a tenant-scoped operation')
    return ctx.tenantId
  }

  static isSystem(): boolean {
    return TenantContext.als.getStore()?.system === true
  }

  /** Run `fn` without tenant scoping (explicit, auditable escape hatch for cross-tenant jobs). */
  static system<T>(fn: () => T, extra: Partial<TenantContextValue> = {}): T {
    const parent = TenantContext.als.getStore()
    return TenantContext.als.run({ tenantId: extra.tenantId ?? parent?.tenantId ?? null, system: true, requestId: parent?.requestId, ...extra }, () => settle(fn()))
  }

  /**
   * Run with NO tenant scoping at all, for a lookup keyed by a globally-unique secret that is not yet tied to a
   * tenant — e.g. finding a refresh session by its token hash. Unlike `system()`, this never inherits the parent's
   * tenantId, so the query is not silently narrowed to the request's tenant (Ж13: refresh worked for one org only).
   */
  static crossTenant<T>(fn: () => T): T {
    const parent = TenantContext.als.getStore()
    return TenantContext.als.run({ tenantId: null, system: true, requestId: parent?.requestId }, () => settle(fn()))
  }

  /** Narrow a system context to one tenant (used by jobs iterating over tenants). */
  static forTenant<T>(tenantId: string, fn: () => T, extra: Partial<TenantContextValue> = {}): T {
    const parent = TenantContext.als.getStore()
    return TenantContext.als.run({ tenantId, system: false, requestId: parent?.requestId, ...extra }, () => settle(fn()))
  }
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as { then?: unknown }).then === 'function'

/** Await thenables inside the current async context so lazy queries run with the store attached. */
function settle<T>(result: T): T {
  if (!isThenable(result)) return result
  return (async () => await result)() as unknown as T
}
