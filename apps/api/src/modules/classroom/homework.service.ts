import { Injectable } from '@nestjs/common'
import { canSubmitHomework, homeworkDeadline, homeworkState, isSafeExternalUrl, type HomeworkSubmitMode } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import type { ExtensionInput, GradeInput, HomeworkInput, HomeworkPatch, SubmissionInput } from './classroom.schemas'
import { assertGroupWritable, assertManages, loadGroup } from './group-access'

type HomeworkRow = { id: string; groupId: string; title: string; description: string; links: string[]; submitModes: string[]; dueAt: Date; createdAt: Date; updatedAt: Date }
const toHomework = (h: HomeworkRow) => ({
  id: h.id, groupId: h.groupId, title: h.title, description: h.description, links: h.links, submitModes: h.submitModes as HomeworkSubmitMode[],
  dueAt: h.dueAt.toISOString(), createdAt: h.createdAt.toISOString(), updatedAt: h.updatedAt.toISOString(),
})
type SubmissionRow = { id: string; text: string | null; link: string | null; submittedAt: Date; grade: number | null; comment: string | null; gradedAt: Date | null }
const toSubmission = (s: SubmissionRow) => ({ id: s.id, text: s.text, link: s.link, submittedAt: s.submittedAt.toISOString(), grade: s.grade, comment: s.comment, gradedAt: s.gradedAt?.toISOString() ?? null })

/** The links of a homework or a hand-in: plain https only (never javascript:, data: or //, security review 19.11 №3). */
function cleanLinks(links: string[]) {
  const out = [...new Set(links.map((l) => l.trim()).filter(Boolean))]
  if (out.some((l) => !isSafeExternalUrl(l))) throw AppError.invalid('homework_bad_link', 'Links must be plain https links')
  return out
}
/** ZIP comes with the second stage (8.4): until the private bucket and the archive checks exist it is refused. */
function cleanModes(modes: (HomeworkSubmitMode | 'ZIP')[]): HomeworkSubmitMode[] {
  const out = [...new Set(modes)]
  if (out.includes('ZIP')) throw AppError.invalid('homework_zip_not_yet', 'ZIP hand-ins are not available yet')
  if (!out.length) throw AppError.invalid('validation_failed', 'Choose how the homework is handed in')
  return out as HomeworkSubmitMode[]
}

/**
 * Homework (ТЗ 2026-11-18, раздел 8, first stage: text and links). The group's teacher gives it, the group's students hand
 * it in — subscribers through their enrollment, the center's own students once they accepted the invitation — again and
 * again before their deadline; after it only with the teacher's extension. The teacher grades 1–5 with a comment.
 */
@Injectable()
export class HomeworkService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private get db() {
    return this.prisma.client
  }

  /** Students who see the group's homework: ILMORA enrollments and the center's own students with an account. */
  private async roster(groupId: string, centerId: string) {
    const [enrollments, links] = await Promise.all([
      this.db.enrollment.findMany({ where: { groupId, status: 'ACTIVE' }, select: { studentId: true, student: { select: { displayName: true } } } }),
      this.db.centerStudentGroup.findMany({ where: { groupId, centerStudent: { centerId, userId: { not: null }, status: { not: 'LEFT' } } }, select: { centerStudent: { select: { userId: true, fullName: true } } } }),
    ])
    const out = new Map<string, { id: string; name: string; via: 'ilmora' | 'center' }>()
    for (const e of enrollments) out.set(e.studentId, { id: e.studentId, name: e.student.displayName, via: 'ilmora' })
    for (const l of links) if (!out.has(l.centerStudent.userId!)) out.set(l.centerStudent.userId!, { id: l.centerStudent.userId!, name: l.centerStudent.fullName, via: 'center' })
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** The groups whose homework a student sees. */
  private async groupsOf(studentId: string) {
    const [enrollments, links] = await Promise.all([
      this.db.enrollment.findMany({ where: { studentId, status: 'ACTIVE' }, select: { groupId: true } }),
      this.db.centerStudentGroup.findMany({ where: { centerStudent: { userId: studentId, status: { not: 'LEFT' } } }, select: { groupId: true, centerStudent: { select: { centerId: true } }, group: { select: { course: { select: { centerId: true } } } } } }),
    ])
    // A center's record links only that center's groups (checked when written; checked again here).
    return [...new Set([...enrollments.map((e) => e.groupId), ...links.filter((l) => l.centerStudent.centerId === l.group.course.centerId).map((l) => l.groupId)])]
  }

  // ───────── teacher ─────────

  private async ownHomework(id: string, actor: RequestActor) {
    const hw = await this.db.homework.findFirst({ where: { id } })
    if (!hw) throw AppError.notFound('Homework')
    const group = await loadGroup(this.prisma, hw.groupId)
    assertManages(group, actor, { centerAdmin: false })
    return { hw, group }
  }

  async list(actor: RequestActor, groupId: string) {
    const group = await loadGroup(this.prisma, groupId)
    assertManages(group, actor, { centerAdmin: false })
    const [items, roster] = await Promise.all([this.db.homework.findMany({ where: { groupId }, orderBy: { dueAt: 'desc' } }), this.roster(groupId, group.course.centerId)])
    const ids = roster.map((r) => r.id)
    const subs = items.length && ids.length ? await this.db.homeworkSubmission.findMany({ where: { homeworkId: { in: items.map((h) => h.id) }, studentId: { in: ids } }, select: { homeworkId: true, studentId: true } }) : []
    return {
      group: { id: group.id, name: group.name, courseTitle: group.course.title, centerName: group.course.center.name },
      students: roster.length,
      items: items.map((h) => ({ ...toHomework(h), submitted: new Set(subs.filter((s) => s.homeworkId === h.id).map((s) => s.studentId)).size })),
    }
  }

  async create(actor: RequestActor, input: HomeworkInput) {
    const group = await loadGroup(this.prisma, input.groupId)
    assertManages(group, actor, { centerAdmin: false })
    assertGroupWritable(group, actor)
    const dueAt = new Date(input.dueAt)
    if (dueAt.getTime() <= Date.now()) throw AppError.invalid('homework_due_past', 'The deadline must be in the future')
    const data = { tenantId: group.tenantId, groupId: group.id, title: input.title.trim(), description: input.description.trim(), links: cleanLinks(input.links ?? []), submitModes: cleanModes(input.submitModes), dueAt, createdById: actor.id }
    const hw = await this.prisma.tx(async (tx) => {
      const created = await tx.homework.create({ data })
      await this.audit.record({ tx, action: 'homework.create', entityType: 'Homework', entityId: created.id, after: { groupId: group.id, dueAt } })
      return created
    })
    return toHomework(hw)
  }

  async update(actor: RequestActor, id: string, patch: HomeworkPatch) {
    const { hw, group } = await this.ownHomework(id, actor)
    assertGroupWritable(group, actor)
    const data: Record<string, unknown> = {}
    if (patch.title !== undefined) data.title = patch.title.trim()
    if (patch.description !== undefined) data.description = patch.description.trim()
    if (patch.links !== undefined) data.links = cleanLinks(patch.links)
    if (patch.submitModes !== undefined) data.submitModes = cleanModes(patch.submitModes)
    if (patch.dueAt !== undefined) data.dueAt = new Date(patch.dueAt)
    const updated = await this.prisma.tx(async (tx) => {
      const row = await tx.homework.update({ where: { id: hw.id }, data })
      await this.audit.record({ tx, action: 'homework.update', entityType: 'Homework', entityId: hw.id, before: { dueAt: hw.dueAt }, after: { dueAt: row.dueAt, fields: Object.keys(data) } })
      return row
    })
    return toHomework(updated)
  }

  /** Only a homework nobody handed in yet: hand-ins are the students' work and stay. */
  async remove(actor: RequestActor, id: string) {
    const { hw, group } = await this.ownHomework(id, actor)
    assertGroupWritable(group, actor)
    const hasSubmissions = () => AppError.conflict('homework_has_submissions', 'There are hand-ins: the homework cannot be deleted')
    if ((await this.db.homeworkSubmission.count({ where: { homeworkId: hw.id } })) > 0) throw hasSubmissions()
    try {
      await this.prisma.tx(async (tx) => {
        // A hand-in that lands after the check above is held by the foreign key (RESTRICT, security review 20.11 №8).
        await tx.homework.delete({ where: { id: hw.id } })
        await this.audit.record({ tx, action: 'homework.delete', entityType: 'Homework', entityId: hw.id, before: { groupId: hw.groupId, title: hw.title } })
      })
    } catch (err) {
      if (['P2003', 'P2014'].includes((err as { code?: string }).code ?? '')) throw hasSubmissions()
      throw err
    }
    return { ok: true as const }
  }

  /** The teacher's list (8.3): every student of the group, handed in / late / not, the last hand-in and the history. */
  async detail(actor: RequestActor, id: string) {
    const { hw, group } = await this.ownHomework(id, actor)
    const roster = await this.roster(group.id, group.course.centerId)
    const ids = roster.map((r) => r.id)
    const [subs, extensions] = await Promise.all([
      ids.length ? this.db.homeworkSubmission.findMany({ where: { homeworkId: hw.id, studentId: { in: ids } }, orderBy: { submittedAt: 'desc' } }) : [],
      this.db.homeworkExtension.findMany({ where: { homeworkId: hw.id } }),
    ])
    return {
      homework: toHomework(hw),
      group: { id: group.id, name: group.name, courseTitle: group.course.title },
      students: roster.map((st) => {
        const mine = subs.filter((s) => s.studentId === st.id)
        const ext = extensions.find((e) => e.studentId === st.id)
        return {
          id: st.id, name: st.name, via: st.via,
          state: homeworkState(hw.dueAt, mine[0]?.submittedAt), last: mine[0] ? toSubmission(mine[0]) : null, history: mine.slice(1).map(toSubmission),
          extendedTo: ext?.dueAt.toISOString() ?? null,
        }
      }),
    }
  }

  private async assertInRoster(groupId: string, centerId: string, studentId: string) {
    if (!(await this.roster(groupId, centerId)).some((r) => r.id === studentId)) throw AppError.invalid('homework_not_in_group', 'The student is not in this group')
  }

  /** A later deadline for one student (8.2). */
  async extend(actor: RequestActor, id: string, input: ExtensionInput) {
    const { hw, group } = await this.ownHomework(id, actor)
    assertGroupWritable(group, actor)
    await this.assertInRoster(group.id, group.course.centerId, input.studentId)
    const dueAt = new Date(input.dueAt)
    if (dueAt.getTime() <= Date.now()) throw AppError.invalid('homework_due_past', 'The new deadline must be in the future')
    const ext = await this.prisma.tx(async (tx) => {
      const row = await tx.homeworkExtension.upsert({
        where: { homeworkId_studentId: { homeworkId: hw.id, studentId: input.studentId } },
        create: { tenantId: hw.tenantId, homeworkId: hw.id, studentId: input.studentId, dueAt, grantedById: actor.id },
        update: { dueAt, grantedById: actor.id },
      })
      await this.audit.record({ tx, action: 'homework.extend', entityType: 'Homework', entityId: hw.id, after: { studentId: input.studentId, dueAt } })
      return row
    })
    return { studentId: ext.studentId, extendedTo: ext.dueAt.toISOString() }
  }

  /** Grade 1–5 and a comment on the student's latest hand-in (8.3); the student sees both. */
  async grade(actor: RequestActor, id: string, input: GradeInput) {
    const { hw, group } = await this.ownHomework(id, actor)
    assertGroupWritable(group, actor)
    await this.assertInRoster(group.id, group.course.centerId, input.studentId)
    const last = await this.db.homeworkSubmission.findFirst({ where: { homeworkId: hw.id, studentId: input.studentId }, orderBy: { submittedAt: 'desc' } })
    if (!last) throw AppError.invalid('homework_nothing_to_grade', 'The student has not handed it in yet')
    const updated = await this.prisma.tx(async (tx) => {
      const row = await tx.homeworkSubmission.update({ where: { id: last.id }, data: { grade: input.grade, comment: input.comment?.trim() || null, gradedAt: new Date(), gradedById: actor.id } })
      await this.audit.record({ tx, action: 'homework.grade', entityType: 'HomeworkSubmission', entityId: last.id, before: { grade: last.grade }, after: { grade: row.grade, homeworkId: hw.id, studentId: input.studentId } })
      return row
    })
    return toSubmission(updated)
  }

  // ───────── student ─────────

  async myList(actor: RequestActor) {
    const groupIds = await this.groupsOf(actor.id)
    if (!groupIds.length) return []
    const items = await this.db.homework.findMany({ where: { groupId: { in: groupIds } }, include: { group: { select: { id: true, name: true, course: { select: { title: true, center: { select: { name: true } } } } } } }, orderBy: { dueAt: 'desc' }, take: 300 })
    const [subs, exts] = items.length
      ? await Promise.all([
          this.db.homeworkSubmission.findMany({ where: { studentId: actor.id, homeworkId: { in: items.map((h) => h.id) } }, orderBy: { submittedAt: 'desc' } }),
          this.db.homeworkExtension.findMany({ where: { studentId: actor.id, homeworkId: { in: items.map((h) => h.id) } } }),
        ])
      : [[], []]
    const now = new Date()
    return items.map((h) => {
      const last = subs.find((s) => s.homeworkId === h.id)
      const ext = exts.find((e) => e.homeworkId === h.id)
      return {
        ...toHomework(h), group: { id: h.group.id, name: h.group.name, courseTitle: h.group.course.title, centerName: h.group.course.center.name },
        state: homeworkState(h.dueAt, last?.submittedAt), last: last ? toSubmission(last) : null, extendedTo: ext?.dueAt.toISOString() ?? null,
        open: canSubmitHomework(h.dueAt, ext?.dueAt, now), deadline: homeworkDeadline(h.dueAt, ext?.dueAt).toISOString(),
      }
    })
  }

  /** A homework of one of the student's own groups (somebody else's is 404, as if it did not exist). */
  private async mine(actor: RequestActor, id: string) {
    const hw = await this.db.homework.findFirst({ where: { id }, include: { group: { select: { id: true, name: true, course: { select: { title: true, center: { select: { name: true, status: true } } } } } } } })
    if (!hw || !(await this.groupsOf(actor.id)).includes(hw.groupId)) throw AppError.notFound('Homework')
    return hw
  }

  async myDetail(actor: RequestActor, id: string) {
    const hw = await this.mine(actor, id)
    const [subs, ext] = await Promise.all([
      this.db.homeworkSubmission.findMany({ where: { homeworkId: hw.id, studentId: actor.id }, orderBy: { submittedAt: 'desc' } }),
      this.db.homeworkExtension.findUnique({ where: { homeworkId_studentId: { homeworkId: hw.id, studentId: actor.id } } }),
    ])
    return {
      homework: toHomework(hw), group: { id: hw.group.id, name: hw.group.name, courseTitle: hw.group.course.title, centerName: hw.group.course.center.name },
      state: homeworkState(hw.dueAt, subs[0]?.submittedAt), submissions: subs.map(toSubmission), extendedTo: ext?.dueAt.toISOString() ?? null,
      open: canSubmitHomework(hw.dueAt, ext?.dueAt), deadline: homeworkDeadline(hw.dueAt, ext?.dueAt).toISOString(),
    }
  }

  /** Hands the work in (again): before the student's deadline, in a way the homework accepts; every hand-in is kept. */
  async submit(actor: RequestActor, id: string, input: SubmissionInput) {
    const hw = await this.mine(actor, id)
    if (hw.group.course.center.status === 'BLOCKED' || hw.group.course.center.status === 'REJECTED') throw AppError.forbidden('This center is blocked', { code: 'center_blocked' })
    const ext = await this.db.homeworkExtension.findUnique({ where: { homeworkId_studentId: { homeworkId: hw.id, studentId: actor.id } } })
    if (!canSubmitHomework(hw.dueAt, ext?.dueAt)) throw AppError.invalid('homework_closed', 'The deadline has passed')
    const text = input.text?.trim() || null
    const link = input.link?.trim() || null
    if (!text && !link) throw AppError.invalid('homework_empty', 'Enter the text or the link')
    if ((text && !hw.submitModes.includes('TEXT')) || (link && !hw.submitModes.includes('LINK'))) throw AppError.invalid('homework_mode', 'This homework is not handed in this way')
    if (link) cleanLinks([link])
    const sub = await this.prisma.tx(async (tx) => {
      const row = await tx.homeworkSubmission.create({ data: { tenantId: hw.tenantId, homeworkId: hw.id, studentId: actor.id, text, link } })
      await this.audit.record({ tx, action: 'homework.submit', entityType: 'HomeworkSubmission', entityId: row.id, after: { homeworkId: hw.id, text: !!text, link: !!link } })
      return row
    })
    return toSubmission(sub)
  }
}
