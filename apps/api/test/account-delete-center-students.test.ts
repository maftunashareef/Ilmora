import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

/**
 * Security check 20.11 (note «2026-11-20 Проверка безопасности ILMORA»), finding №13: deleting an account
 * (ManageService.deleteUser — the only deletion flow: soft delete by the Super Admin) frees the login, phone and Google
 * link, ends the consents and erases the copies of contacts on ContactRequest / VacancyApplication (`shared*` = null).
 * It does not touch what the centers' «Студенты» (#118) keep about the same person: the CenterStudent rows linked to the
 * account by userId still hold the full name, phone, birth date and the parent's name and phone, and the homework the
 * student handed in keeps its text and link.
 *
 * The other place that soft-deletes accounts, apps/api/src/cli/cleanup-accounts.ts:32, scrubs nothing at all (not even
 * the phone) and is not covered here.
 *
 * Rule, mirroring that pattern (rows stay for the center's history, the personal data goes): after the account is
 * deleted, every CenterStudent row that was linked to it either is gone or no longer holds the person's full name, phone,
 * birth date, parent's name or parent's phone, place of study (institutionText) or year (studyYear); and every
 * HomeworkSubmission of the account either is gone or has no text and no link. A row of another student of the same
 * center is not touched. Rows are read with includeDeleted, so a fix that soft-deletes them still has to scrub them.
 *
 * Policy, not settled here (Тимур): a CENTER-sourced row was typed by the center itself and is its own register (journal,
 * attendance marks). Wiping it on the student's deletion is a decision; the rule follows the brief of finding №13.
 *
 * KNOWN_GAP pins today's exact observation (every linked row and the submission are exactly as before). When a part is
 * fixed, its check fails with «remove 'n13-…' from KNOWN_GAP» — then remove the key and the rule is demanded from then
 * on; any other outcome fails as «re-evaluate».
 */
const KNOWN_GAP = new Set(['n13-center-student', 'n13-homework'])
const checked = new Set<string>()
function rule(key: string, holds: boolean, what: string, todayObserved: boolean) {
  checked.add(key)
  if (KNOWN_GAP.has(key)) {
    expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
    expect(todayObserved, `${what} — not today's known outcome: re-evaluate '${key}'`).toBe(true)
  } else expect(holds, what).toBe(true)
}

const phone = () => `+99893${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`

describe.skipIf(!DB_AVAILABLE)('№13 deleting an account takes the person\'s data out of the centers\' student records and homework', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(async () => {
    await ctx.close()
    for (const key of KNOWN_GAP) expect(checked.has(key), `'${key}' in KNOWN_GAP was never checked`).toBe(true)
  })

  it('the linked CenterStudent rows and the homework handed in lose the personal data; another student\'s row stays', async () => {
    const t = await ctx.makeTenant('n13')
    const student = await ctx.makeStudent(t.tenantId)
    const neighbour = await ctx.makeStudent(t.tenantId)
    const person = { fullName: 'Aziza Karimova', phoneE164: phone(), birthDate: new Date('2010-03-15'), parentName: 'Dilshod Karimov', parentPhoneE164: phone(), institutionType: 'SCHOOL' as const, institutionText: 'Toshkent 110-maktab', studyYear: 9 }
    const other = await TenantContext.system(() => db.center.create({ data: { tenantId: t.tenantId, slug: `n13-other-${t.tenantId}`, name: 'Other', district: {}, description: {} } }))

    const { linked, neighbourRow, submission } = await TenantContext.system(async () => {
      // Two centers know the student: one invited her (CENTER), the other has her from ILMORA (no phone of its own).
      const linked = [
        await db.centerStudent.create({ data: { tenantId: t.tenantId, centerId: t.center.id, source: 'CENTER', userId: student.id, ...person, inviteAcceptedAt: new Date() } }),
        await db.centerStudent.create({ data: { tenantId: t.tenantId, centerId: other.id, source: 'ILMORA', userId: student.id, fullName: person.fullName, birthDate: person.birthDate, parentName: person.parentName, parentPhoneE164: person.parentPhoneE164, institutionType: person.institutionType, institutionText: person.institutionText, studyYear: person.studyYear } }),
      ]
      const neighbourRow = await db.centerStudent.create({ data: { tenantId: t.tenantId, centerId: t.center.id, source: 'CENTER', userId: neighbour.id, fullName: 'Bobur Aliyev', phoneE164: phone(), birthDate: new Date('2009-01-01'), inviteAcceptedAt: new Date() } })
      const hw = await db.homework.create({ data: { tenantId: t.tenantId, groupId: t.group.id, title: 'Vazifa', description: 'Matn', submitModes: ['TEXT', 'LINK'], dueAt: new Date(Date.now() + 86_400_000) } })
      const submission = await db.homeworkSubmission.create({ data: { tenantId: t.tenantId, homeworkId: hw.id, studentId: student.id, text: 'Mening javobim: Aziza, 15 yosh', link: 'https://example.com/aziza-work' } })
      return { linked, neighbourRow, submission }
    })

    const manage = new ManageService(ctx.prisma, ctx.audit, {} as SessionsService, {} as SiteService, notificationsStub, ctx.env)
    await TenantContext.forTenant(t.tenantId, () => manage.deleteUser(t.tenantId, { id: 'admin', roles: ['PLATFORM_ADMIN'], centerId: null }, student.id, 'test'))

    // Setup sanity, outside the rule: the account really is deleted (the flow ran to the end).
    const account = await TenantContext.system(() => db.user.findFirstOrThrow({ where: { id: student.id }, includeDeleted: true } as never)) as { deletedAt: Date | null; phoneE164: string | null }
    expect(account.deletedAt).not.toBeNull()
    expect(account.phoneE164).toBeNull()

    const rows = await TenantContext.system(() => db.centerStudent.findMany({ where: { id: { in: linked.map((r) => r.id) } }, includeDeleted: true } as never)) as unknown as typeof linked
    const holding = rows.filter((r) => r.fullName === person.fullName || (r.phoneE164 !== null && r.phoneE164 === person.phoneE164) || r.birthDate !== null
      || r.parentName === person.parentName || (r.parentPhoneE164 !== null && r.parentPhoneE164 === person.parentPhoneE164)
      || r.institutionText === person.institutionText || r.studyYear === person.studyYear)
    // Today: both rows are exactly as they were (only updatedAt aside), still linked to the account.
    const asBefore = rows.length === linked.length && linked.every((l) => {
      const r = rows.find((x) => x.id === l.id)
      return !!r && JSON.stringify({ ...r, updatedAt: null }) === JSON.stringify({ ...l, updatedAt: null })
    })
    rule('n13-center-student', holding.length === 0, `no CenterStudent row of the deleted account keeps the name, phone, birth date, parent's contacts or place of study (now ${holding.length} of ${linked.length} still do)`, asBefore)

    const sub = await TenantContext.system(() => db.homeworkSubmission.findFirst({ where: { id: submission.id }, includeDeleted: true } as never)) as unknown as typeof submission | null
    rule('n13-homework', !sub || (sub.text === null && sub.link === null), `the homework the deleted account handed in keeps no text or link (now: ${sub ? `text ${sub.text === null ? 'null' : 'kept'}, link ${sub.link === null ? 'null' : 'kept'}` : 'row gone'})`,
      !!sub && JSON.stringify(sub) === JSON.stringify(submission))

    // Another student of the same center is not affected (outside the rule: holds today and after the fix).
    const kept = await TenantContext.system(() => db.centerStudent.findUniqueOrThrow({ where: { id: neighbourRow.id }, includeDeleted: true } as never)) as unknown as typeof neighbourRow
    expect(kept).toMatchObject({ fullName: neighbourRow.fullName, phoneE164: neighbourRow.phoneE164, userId: neighbour.id })
  })
})
