import { JwtService } from '@nestjs/jwt'
import { randomUUID } from 'node:crypto'
import { type Env, validateEnv } from '../src/config/env'
import { PrismaService } from '../src/infra/prisma/prisma.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { AuditService } from '../src/modules/audit/audit.service'
import { TokenService } from '../src/modules/auth/token.service'
import { SubscriptionService } from '../src/modules/enrollment/subscription.service'
import { LedgerService } from '../src/modules/payments/ledger.service'
import { OutboxService } from '../src/modules/payments/outbox.service'
import { PaymentsService } from '../src/modules/payments/payments.service'
import { notificationsStub } from './stubs'

/** Tests that need PostgreSQL run only when TEST_DATABASE_URL (or DATABASE_URL) is reachable; see test/setup.ts. */
export const DB_AVAILABLE = !!process.env.TEST_DATABASE_URL || process.env.CI === 'true'

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return validateEnv({ ...process.env, ...overrides })
}

export class TestContext {
  readonly env = testEnv()
  readonly prisma = new PrismaService(this.env)
  readonly audit = new AuditService(this.prisma)
  readonly ledger = new LedgerService()
  readonly outbox = new OutboxService(this.prisma)
  readonly subscriptions = new SubscriptionService(this.prisma, this.audit, notificationsStub, this.env)
  readonly payments = new PaymentsService(this.prisma, this.ledger, this.outbox, this.subscriptions, this.audit, this.env)
  readonly tokens = new TokenService(new JwtService({ secret: this.env.JWT_ACCESS_SECRET }), this.env, this.prisma)

  async connect() {
    await this.prisma.onModuleInit()
  }
  async close() {
    await this.prisma.onModuleDestroy()
  }

  /** Fresh tenant with one center/category/teacher/course/group/package; everything is namespaced by a random suffix. */
  async makeTenant(label = 't') {
    const suffix = randomUUID().slice(0, 8)
    const tenantId = `${label}-${suffix}`
    return TenantContext.system(async () => {
      const db = this.prisma.client
      await db.tenant.create({ data: { id: tenantId, slug: `${label}-${suffix}`, name: `Tenant ${suffix}`, webOrigin: 'http://localhost:3000' } })
      await db.siteConfig.create({ data: { tenantId, data: { permissions: { teacher: { editCourses: true, editPrices: false, editSchedules: true, publishDirectly: true, customizeChannel: true, manageGroups: true, uploadResources: true }, student: {} } } } })
      const pkg = await db.package.create({ data: { tenantId, code: 'duo', name: {}, description: {}, perks: [], maxCourses: 2 } })
      const center = await db.center.create({ data: { tenantId, slug: `c-${suffix}`, name: 'Center', district: {}, description: {} } })
      const category = await db.category.create({ data: { tenantId, slug: `cat-${suffix}`, name: {} } })
      const teacherUser = await db.user.create({ data: { tenantId, phoneE164: `+99891${suffix.replace(/\D/g, '').padEnd(7, '1').slice(0, 7)}`, displayName: 'Teacher', roles: ['TEACHER', 'STUDENT'] } })
      const teacher = await db.teacherProfile.create({ data: { tenantId, slug: `t-${suffix}`, name: 'Teacher', title: {}, bio: {}, tagline: {}, centerId: center.id, userId: teacherUser.id } })
      const course = await db.course.create({ data: { tenantId, slug: `course-${suffix}`, title: { uz: 'Kurs', ru: 'Курс', en: 'Course' }, categoryId: category.id, centerId: center.id, teacherId: teacher.id, summary: {}, description: {}, curriculum: [], priceMinor: 50_000_00n, status: 'PUBLISHED', visibility: 'PUBLIC' } })
      const group = await db.group.create({ data: { tenantId, courseId: course.id, name: 'A', days: [0, 2], startTime: '18:00', endTime: '19:30', capacity: 2 } })
      const course2 = await db.course.create({ data: { tenantId, slug: `course2-${suffix}`, title: { uz: 'Kurs 2', ru: 'Курс 2', en: 'Course 2' }, categoryId: category.id, centerId: center.id, teacherId: teacher.id, summary: {}, description: {}, curriculum: [], priceMinor: 30_000_00n, status: 'PUBLISHED', visibility: 'PUBLIC' } })
      const group2 = await db.group.create({ data: { tenantId, courseId: course2.id, name: 'B', days: [1, 3], startTime: '18:00', endTime: '19:30', capacity: 5 } })
      return { tenantId, pkg, center, category, teacher, teacherUser, course, group, course2, group2 }
    })
  }

  async makeStudent(tenantId: string, n = Math.floor(Math.random() * 90_000) + 10_000) {
    return TenantContext.system(() => this.prisma.client.user.create({ data: { tenantId, phoneE164: `+9989000${String(n).padStart(5, '0')}`, displayName: `Student ${n}`, roles: ['STUDENT'] } }))
  }

  /** Draft + checkout for the given groups; returns the pending payment and subscription. */
  async checkout(tenantId: string, studentId: string, packageId: string, groupIds: string[]) {
    return TenantContext.forTenant(tenantId, async () => {
      await this.subscriptions.saveDraft(tenantId, studentId, { packageId, groupIds, meyosGrant: false })
      return this.subscriptions.checkout(tenantId, studentId, 'PAYME')
    })
  }
}
