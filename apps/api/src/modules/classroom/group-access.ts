import { AppError } from '../../common/errors'
import type { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'

/** A group with what the journal and homework need to decide who may touch it. */
export async function loadGroup(prisma: PrismaService, groupId: string) {
  const group = await prisma.client.group.findFirst({
    where: { id: groupId },
    include: { course: { select: { id: true, title: true, teacherId: true, centerId: true, center: { select: { id: true, name: true, status: true } } } } },
  })
  if (!group) throw AppError.notFound('Group')
  return group
}
export type GroupWithCourse = Awaited<ReturnType<typeof loadGroup>>

/**
 * Who manages a group, the same rule as lessons and QR (AttendanceService): the teacher of the course, the center's own
 * administrator, the Super Admin. Another teacher of the same center is refused — the center is not enough.
 */
export function assertManages(group: GroupWithCourse, actor: RequestActor, opts: { centerAdmin: boolean }) {
  if (actor.roles.includes('PLATFORM_ADMIN')) return
  if (opts.centerAdmin && actor.roles.includes('CENTER_ADMIN') && actor.centerId === group.course.centerId) return
  if (actor.teacherProfileId && actor.teacherProfileId === group.course.teacherId) return
  throw AppError.forbidden('You do not manage this group')
}

/** A blocked or rejected center no longer runs its groups (reads still work); the Super Admin still can. */
export function assertGroupWritable(group: GroupWithCourse, actor: RequestActor) {
  if (actor.roles.includes('PLATFORM_ADMIN')) return
  if (group.course.center.status === 'BLOCKED' || group.course.center.status === 'REJECTED') throw AppError.forbidden('This center is blocked', { code: 'center_blocked' })
}
