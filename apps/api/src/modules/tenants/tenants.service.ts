import { Inject, Injectable } from '@nestjs/common'
import { ENV, type Env } from '../../config/env'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'

interface CacheEntry { id: string; slug: string; webOrigin: string; defaultLang: 'uz' | 'ru' | 'en'; expires: number }

/** Resolves tenant slugs to ids with a short in-memory cache (tenants change rarely). */
@Injectable()
export class TenantsService {
  private readonly bySlug = new Map<string, CacheEntry>()
  private readonly byId = new Map<string, CacheEntry>()
  private readonly ttlMs = 60_000

  constructor(private readonly prisma: PrismaService, @Inject(ENV) private readonly env: Env) {}

  async resolveSlug(slug: string | undefined | null): Promise<CacheEntry | null> {
    const key = (slug && /^[a-z0-9-]{2,40}$/.test(slug) ? slug : this.env.DEFAULT_TENANT_SLUG).toLowerCase()
    const hit = this.bySlug.get(key)
    if (hit && hit.expires > Date.now()) return hit
    const row = await TenantContext.system(() => this.prisma.client.tenant.findFirst({ where: { slug: key }, select: { id: true, slug: true, webOrigin: true, defaultLang: true } }))
    if (!row) return null
    const entry: CacheEntry = { ...row, expires: Date.now() + this.ttlMs }
    this.bySlug.set(key, entry)
    this.byId.set(row.id, entry)
    return entry
  }

  async byTenantId(id: string): Promise<CacheEntry | null> {
    const hit = this.byId.get(id)
    if (hit && hit.expires > Date.now()) return hit
    const row = await TenantContext.system(() => this.prisma.client.tenant.findFirst({ where: { id }, select: { id: true, slug: true, webOrigin: true, defaultLang: true } }))
    if (!row) return null
    const entry: CacheEntry = { ...row, expires: Date.now() + this.ttlMs }
    this.bySlug.set(row.slug, entry)
    this.byId.set(row.id, entry)
    return entry
  }

  async listIds(): Promise<string[]> {
    const rows = await TenantContext.system(() => this.prisma.client.tenant.findMany({ select: { id: true } }))
    return rows.map((r) => r.id)
  }
}
