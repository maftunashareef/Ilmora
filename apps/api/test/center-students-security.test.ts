import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum'
import { CUSTOM_ROUTE_ARGS_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { FULL_NAME_MAX, OFFER_VERSION } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildXlsx } from '../src/common/xlsx'
import { readXlsxRows } from '../src/common/xlsx-read'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import { CenterStudentInput, CenterStudentPatch } from '../src/modules/center/center-students.schemas'
import { CenterStudentsService } from '../src/modules/center/center-students.service'
import { StudentCentersController } from '../src/modules/center/student-centers.controller'
import { TenantsService } from '../src/modules/tenants/tenants.service'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * Студенты центра (PR #118): правила по находкам проверки безопасности 20.11 (заметка «2026-11-20 Проверка безопасности
 * ILMORA»). Номера — номера находок той заметки:
 *
 *  №2  Приглашение не привязано к человеку. Аккаунт, чей телефон не совпадает с телефоном записи (взрослый) или
 *      телефоном родителя (несовершеннолетний), не принимает приглашение (любой 4xx, запись остаётся непривязанной) и
 *      в предпросмотре не видит данных студента (можно только название центра): ни ФИО, ни учебного заведения, ни
 *      курса/класса, ни групп. Способ привязки не решён (совпадение телефона, SMS-код, подтверждение центром), поэтому
 *      правило проверяет только исход. Аккаунт с совпадающим телефоном по-прежнему принимает — или, если исправление
 *      вводит лишний шаг, получает исход «ждёт подтверждения» (ответ без `ok: true` или 4xx с кодом про
 *      code/confirm/pending/sms/otp); запись тогда не привязана к нему, пока шаг не пройден.
 *  №3  Центр видит полную дату рождения студентов, пришедших через ILMORA (и несовершеннолетних): для записей с
 *      source ILMORA ни таблица, ни карточка, ни выгрузка Excel не содержат даты рождения (флаг «несовершеннолетний»
 *      или возраст — можно).
 *  №4  Выданное приглашение переживает смену телефона и архив: после смены phone / parentPhone или статуса LEFT старая
 *      ссылка не открывает предпросмотр и не принимается; запись в статусе LEFT не принимается вовсе.
 *  №9  Заблокированный или отклонённый центр (BLOCKED / REJECTED) не читает и не выгружает студентов (таблица,
 *      карточка, Excel — 403); ФИО родителя длиннее FULL_NAME_MAX в строке файла — ошибка строки.
 *      Лимит записей на ещё не одобренный центр здесь не проверяется (не решён; см. PR).
 *
 * KNOWN_GAP — правила, которые код PR #118 сегодня нарушает (каждое сверено с кодом). Пока ключ в списке, тест требует,
 * чтобы правило НЕ выполнялось — при этом сценарий обязан реально работать (проверки «setup» вне rule()), так что
 * сломанная подготовка тоже валит тест. Когда находку закроют, тест упадёт с подсказкой убрать ключ — с этого момента
 * правило требуется строго.
 */
const KNOWN_GAP = new Set([
  // №2
  'n2-preview', 'n2-accept', 'n2-accept-minor',
  // №3
  'n3-roster', 'n3-detail', 'n3-excel',
  // №4
  'n4-phone-preview', 'n4-phone-accept', 'n4-parent-preview', 'n4-parent-accept', 'n4-left-preview', 'n4-left-accept', 'n4-left-direct-accept',
  // №9
  'n9-BLOCKED-roster', 'n9-BLOCKED-detail', 'n9-BLOCKED-export', 'n9-REJECTED-roster', 'n9-REJECTED-detail', 'n9-REJECTED-export',
  'n9-import-parentname-check', 'n9-import-parentname-commit',
])
function rule(key: string, holds: boolean, what: string) {
  if (KNOWN_GAP.has(key)) expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
  else expect(holds, what).toBe(true)
}

type Outcome = { ok: true; value: unknown } | { ok: false; status: number | undefined; code: string | undefined }
const outcome = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (e: { getStatus?: () => number; code?: string; response?: { code?: string } }) => ({ ok: false as const, status: e.getStatus?.(), code: e.code ?? e.response?.code }),
  )
const refused4xx = (o: Outcome) => !o.ok && o.status !== undefined && o.status >= 400 && o.status < 500
const refused403 = (o: Outcome) => !o.ok && o.status === 403

describe('№9 parentName limit in the form (holds today)', () => {
  it('the hand-entered form refuses a parent name over FULL_NAME_MAX', () => {
    const long = 'A'.repeat(FULL_NAME_MAX + 1)
    expect(CenterStudentInput.safeParse({ fullName: 'Aziz Karimov', birthDate: '2001-05-04', parentName: long }).success).toBe(false)
    expect(CenterStudentPatch.safeParse({ parentName: long }).success).toBe(false)
    expect(CenterStudentInput.safeParse({ fullName: 'Aziz Karimov', birthDate: '2001-05-04', parentName: 'A'.repeat(FULL_NAME_MAX) }).success).toBe(true)
  })
})

describe.skipIf(!DB_AVAILABLE)('Center students: security check 20.11 (№2, №3, №4, №9)', () => {
  const ctx = new TestContext()
  const table = new CenterStudentsService(ctx.prisma, ctx.audit, new TenantsService(ctx.prisma, ctx.env), ctx.env)
  const studentSide = new StudentCentersController(table)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const phone = () => `+99893${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
  const local = (p: string) => p.replace('+998', '')

  async function setup(label = 'css') {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    return TenantContext.forTenant(t.tenantId, async () => {
      await db.center.update({ where: { id: t.center.id }, data: { status: 'ACTIVE', approvedAt: new Date() } })
      const admin = await db.user.create({ data: { tenantId: t.tenantId, login: `adm-${t.tenantId}`, displayName: 'Admin', roles: ['CENTER_ADMIN'], centerId: t.center.id } })
      const center: RequestActor = { id: admin.id, roles: ['CENTER_ADMIN'], centerId: t.center.id }
      return { t, center, tenantId: t.tenantId }
    })
  }
  type S = Awaited<ReturnType<typeof setup>>
  const as = <T>(s: S, actor: RequestActor, fn: () => Promise<T>) => TenantContext.forTenant(s.tenantId, fn, { actor })
  const sys = <T>(s: S, fn: () => Promise<T>) => TenantContext.forTenant(s.tenantId, fn)

  /** A student account signing in with the given phone (E.164). */
  async function account(s: S, phoneE164: string, name = 'Account'): Promise<RequestActor> {
    const u = await TenantContext.system(() => ctx.prisma.client.user.create({ data: { tenantId: s.tenantId, phoneE164, displayName: `${name} ${randomUUID().slice(0, 6)}`, roles: ['STUDENT'], offerAcceptedAt: new Date(), offerVersion: OFFER_VERSION, consentAt: new Date() } }))
    return { id: u.id, roles: ['STUDENT'] }
  }

  /**
   * The student's side through the real controller handler (POST /students/me/center-invites/{preview,accept}): its
   * parameters are resolved from the route metadata (actor, tenant, body with its zod pipe), so the test stays valid
   * whatever the fix adds to the handler's signature.
   */
  async function viaRoute(s: S, actor: RequestActor, path: 'center-invites/preview' | 'center-invites/accept', body: Record<string, unknown>) {
    const proto = StudentCentersController.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
    const name = Object.getOwnPropertyNames(proto).find((k) => k !== 'constructor' && typeof proto[k] === 'function' && Reflect.getMetadata(PATH_METADATA, proto[k]) === path)
    if (!name) throw new Error(`no handler for ${path}`)
    const req = { actor, tenantId: s.tenantId, body, headers: {}, ip: '127.0.0.1', params: {}, query: {} }
    const exec = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }), getHandler: () => proto[name], getClass: () => StudentCentersController }
    const meta = (Reflect.getMetadata(ROUTE_ARGS_METADATA, StudentCentersController, name) ?? {}) as Record<string, { index: number; data?: string; factory?: (d: unknown, c: unknown) => unknown; pipes?: unknown[] }>
    const args: unknown[] = []
    return as(s, actor, async () => {
      for (const [k, m] of Object.entries(meta)) {
        let v: unknown
        if (k.includes(CUSTOM_ROUTE_ARGS_METADATA)) v = m.factory!(m.data, exec)
        else if (Number(k.split(':')[0]) === RouteParamtypes.BODY) v = m.data ? body[m.data] : body
        else throw new Error(`${path}: unexpected parameter ${k}`)
        for (const p of m.pipes ?? []) v = await (typeof p === 'function' ? new (p as new () => { transform: (x: unknown, md: unknown) => unknown })() : (p as { transform: (x: unknown, md: unknown) => unknown })).transform(v, { type: 'body', data: m.data })
        args[m.index] = v
      }
      return (studentSide as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args)
    })
  }
  const preview = (s: S, actor: RequestActor, token: string) => outcome(viaRoute(s, actor, 'center-invites/preview', { token }))
  const accept = (s: S, actor: RequestActor, token: string) => outcome(viaRoute(s, actor, 'center-invites/accept', { token }))

  const create = (s: S, body: Record<string, unknown>) => as(s, s.center, () => table.create(s.tenantId, s.center, body as never)).then((r) => r.student.id)
  const invite = (s: S, id: string) => as(s, s.center, () => table.invite(s.tenantId, s.center, id)).then((o) => new URL(o.url).hash.slice(1))
  const record = (s: S, id: string) => sys(s, () => ctx.prisma.client.centerStudent.findUniqueOrThrow({ where: { id } }))

  /** Fields of the student that a stranger must not see in the preview. */
  const STUDENT_FIELDS = ['fullName', 'institution', 'studyYear', 'groups'] as const
  const showsStudent = (o: Outcome, fullName: string) => {
    if (!o.ok) return false
    const v = (o.value ?? {}) as Record<string, unknown>
    const present = STUDENT_FIELDS.some((f) => { const x = v[f]; return x !== undefined && x !== null && !(Array.isArray(x) && !x.length) })
    return present || JSON.stringify(v).includes(fullName)
  }

  // ───────── №2 ─────────

  it('№2: a stranger account neither accepts the invitation nor sees the student in the preview; the matching phone still accepts', async () => {
    const s = await setup()
    const adultPhone = phone()
    const rec = await create(s, { fullName: 'Aziz Karimov', phone: local(adultPhone), birthDate: '2001-05-04', groupIds: [s.t.group.id], studyYear: 2, institutionText: 'TATU', institutionType: 'UNIVERSITY' })
    const token = await invite(s, rec)
    expect((await record(s, rec)).inviteTokenHash, 'setup: the invitation was issued').toBeTruthy()
    const stranger = await account(s, phone(), 'Stranger')
    const owner = await account(s, adultPhone, 'Owner')

    // Setup: the link works — the owner's preview answers with the center's name.
    const own = await preview(s, owner, token)
    expect(own.ok, 'setup: the owner opens the preview').toBe(true)
    expect((own as { value: { centerName?: string } }).value.centerName, 'setup: the preview names the center').toBe(s.t.center.name)

    const seen = await preview(s, stranger, token)
    rule('n2-preview', !showsStudent(seen, 'Aziz Karimov'), '№2 a stranger\'s preview shows no fullName / institution / studyYear / groups')

    const taken = await accept(s, stranger, token)
    const after = await record(s, rec)
    rule('n2-accept', refused4xx(taken) && after.userId === null && after.inviteAcceptedAt === null, '№2 a stranger cannot accept: 4xx and the record stays unlinked')

    // The matching phone accepts (a second record: a stranger's accept above may have used the first link today).
    const phone2 = phone()
    const rec2 = await create(s, { fullName: 'Bobur Aliyev', phone: local(phone2), birthDate: '2000-01-02' })
    const token2 = await invite(s, rec2)
    const rightful = await account(s, phone2, 'Rightful')
    const res = await accept(s, rightful, token2)
    const linked = (await record(s, rec2)).userId
    const pending = res.ok ? (res.value as { ok?: unknown } | null)?.ok !== true : refused4xx(res) && /code|confirm|pending|sms|otp/i.test(res.code ?? '')
    if (pending) expect(linked, '№2 «waiting for confirmation»: not linked yet').toBeNull()
    else {
      expect(res, '№2 the account with the record\'s phone still accepts').toMatchObject({ ok: true, value: { ok: true } })
      expect(linked, '№2 the record is linked to the account that accepted').toBe(rightful.id)
    }
  })

  it('№2: a stranger account cannot accept a minor\'s invitation (it goes to the parent\'s phone)', async () => {
    const s = await setup()
    const rec = await create(s, { fullName: 'Malika Karimova', birthDate: '2013-02-01', parentName: 'Dilnoza Karimova', parentPhone: local(phone()), groupIds: [s.t.group.id] })
    const token = await invite(s, rec)
    const stranger = await account(s, phone(), 'Stranger')
    expect((await record(s, rec)).inviteTokenHash, 'setup: the invitation was issued').toBeTruthy()
    const seen = await preview(s, stranger, token)
    expect(seen.ok || refused4xx(seen), 'setup: the preview answers (or refuses with 4xx), never fails otherwise').toBe(true)
    const taken = await accept(s, stranger, token)
    const after = await record(s, rec)
    rule('n2-accept-minor', refused4xx(taken) && after.userId === null, '№2 a stranger cannot take a minor\'s record')
  })

  // ───────── №3 ─────────

  it('№3: the birth date of a student who came through ILMORA is in neither the table, the card nor the Excel export', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const kid = await account(s, phone(), 'Ilmora kid')
    const grown = await account(s, phone(), 'Ilmora adult')
    const births: [RequestActor, string, string][] = [[kid, '2012-03-15', '15.03.2012'], [grown, '2000-07-21', '21.07.2000']]
    await sys(s, async () => {
      for (const [u, iso] of births) {
        await db.studentProfile.create({ data: { tenantId: s.tenantId, userId: u.id, mode: 'STUDYING', birthDate: new Date(`${iso}T00:00:00.000Z`) } })
        const sub = await db.subscription.create({ data: { tenantId: s.tenantId, studentId: u.id, status: 'ACTIVE' } })
        await db.enrollment.create({ data: { tenantId: s.tenantId, subscriptionId: sub.id, studentId: u.id, groupId: s.t.group.id, courseId: s.t.course.id, status: 'ACTIVE', enrolledAt: new Date('2026-01-01T00:00:00.000Z') } })
      }
    })
    const roster = await as(s, s.center, () => table.roster(s.tenantId, s.center, {}))
    const mine = roster.rows.filter((r) => r.source === 'ILMORA')
    expect(mine.map((r) => (r as { linked: boolean }).linked), 'setup: both ILMORA students are in the table').toEqual([true, true])
    const has = (x: unknown, iso: string, dmy: string) => { const j = JSON.stringify(x); return j.includes(iso) || j.includes(dmy) }
    const rowBirth = (r: unknown) => (r as Record<string, unknown>).birthDate
    rule('n3-roster', mine.every((r) => !rowBirth(r)) && !births.some(([, iso, dmy]) => has(roster, iso, dmy)), '№3 the table has no birth date of ILMORA students')

    const cards = await Promise.all(mine.map((r) => as(s, s.center, () => table.detail(s.tenantId, s.center, r.id))))
    expect(cards.map((c) => c.student.source), 'setup: the cards open').toEqual(['ILMORA', 'ILMORA'])
    rule('n3-detail', cards.every((c) => !rowBirth(c.student)) && !births.some(([, iso, dmy]) => has(cards, iso, dmy)), '№3 the card has no birth date of an ILMORA student')

    const file = await as(s, s.center, () => table.exportFile(s.tenantId, s.center, { lang: 'ru' }))
    const sheet = readXlsxRows(file.file)
    expect(sheet.length, 'setup: the export has the two students').toBe(3)
    const cells = sheet.slice(1).flatMap((r) => r.cells)
    rule('n3-excel', !births.some(([, iso, dmy]) => cells.some((c) => c.includes(iso) || c.includes(dmy))), '№3 the Excel export has no birth date of ILMORA students')
  })

  // ───────── №4 ─────────

  it('№4: after the student\'s phone changes, the old link neither previews nor is accepted (by the new phone either)', async () => {
    const s = await setup()
    const oldPhone = phone()
    const rec = await create(s, { fullName: 'Aziz Karimov', phone: local(oldPhone), birthDate: '2001-05-04' })
    const token = await invite(s, rec)
    expect((await preview(s, await account(s, oldPhone, 'Old phone'), token)).ok, 'setup: the link works before the change').toBe(true)
    // The account of the NEW phone tries the old link: whatever binding №2 brings, it matches the record now.
    const newPhone = phone()
    const holder = await account(s, newPhone, 'New phone')
    await as(s, s.center, () => table.update(s.tenantId, s.center, rec, { phone: local(newPhone) }))
    expect((await record(s, rec)).phoneE164, 'setup: the phone changed').toBe(newPhone)
    rule('n4-phone-preview', refused4xx(await preview(s, holder, token)), '№4 the old link opens no preview after a phone change')
    const res = await accept(s, holder, token)
    rule('n4-phone-accept', refused4xx(res) && (await record(s, rec)).userId === null, '№4 the old link is not accepted after a phone change')
  })

  it('№4: after a minor\'s parent phone changes, the old link neither previews nor is accepted', async () => {
    const s = await setup()
    const oldParent = phone()
    const rec = await create(s, { fullName: 'Malika Karimova', birthDate: '2013-02-01', parentName: 'Dilnoza Karimova', parentPhone: local(oldParent) })
    const token = await invite(s, rec)
    expect((await preview(s, await account(s, oldParent, 'Old parent phone'), token)).ok, 'setup: the link works before the change').toBe(true)
    const newParent = phone()
    const holder = await account(s, newParent, 'New parent phone')
    await as(s, s.center, () => table.update(s.tenantId, s.center, rec, { parentPhone: local(newParent) }))
    expect((await record(s, rec)).parentPhoneE164, 'setup: the parent phone changed').toBe(newParent)
    rule('n4-parent-preview', refused4xx(await preview(s, holder, token)), '№4 the old link opens no preview after a parent phone change')
    const res = await accept(s, holder, token)
    rule('n4-parent-accept', refused4xx(res) && (await record(s, rec)).userId === null, '№4 the old link is not accepted after a parent phone change')
  })

  it('№4: a record sent to the archive (LEFT) is not accepted, whether by the old link or with a link still on it', async () => {
    const s = await setup()
    const p = phone()
    const rec = await create(s, { fullName: 'Aziz Karimov', phone: local(p), birthDate: '2001-05-04' })
    const token = await invite(s, rec)
    const owner = await account(s, p, 'Owner')
    expect((await preview(s, owner, token)).ok, 'setup: the link works before the archive').toBe(true)
    await as(s, s.center, () => table.update(s.tenantId, s.center, rec, { status: 'LEFT' }))
    expect((await record(s, rec)).status, 'setup: the record is in the archive').toBe('LEFT')
    rule('n4-left-preview', refused4xx(await preview(s, owner, token)), '№4 the link of an archived record opens no preview')
    const res = await accept(s, owner, token)
    rule('n4-left-accept', refused4xx(res) && (await record(s, rec)).userId === null, '№4 the link of an archived record is not accepted')

    // A LEFT record that still carries a live token (however it got there) is refused at accept time too.
    const p2 = phone()
    const rec2 = await create(s, { fullName: 'Bobur Aliyev', phone: local(p2), birthDate: '2000-01-02' })
    const token2 = await invite(s, rec2)
    await sys(s, () => ctx.prisma.client.centerStudent.update({ where: { id: rec2 }, data: { status: 'LEFT', archivedAt: new Date() } }))
    const live = await record(s, rec2)
    expect(live.inviteTokenHash && live.inviteExpiresAt!.getTime() > Date.now(), 'setup: the token is still on the archived record').toBeTruthy()
    const owner2 = await account(s, p2, 'Owner 2')
    const res2 = await accept(s, owner2, token2)
    rule('n4-left-direct-accept', refused4xx(res2) && (await record(s, rec2)).userId === null, '№4 a LEFT record is not accepted')
  })

  // ───────── №9 ─────────

  for (const status of ['BLOCKED', 'REJECTED'] as const) {
    it(`№9: a ${status} center neither reads nor exports its students (and still writes nothing)`, async () => {
      const s = await setup()
      const rec = await create(s, { fullName: 'Aziz Karimov', phone: local(phone()), birthDate: '2001-05-04' })
      // Setup: while active, the table, the card and the export work and have the student.
      expect((await as(s, s.center, () => table.roster(s.tenantId, s.center, {}))).rows.map((r) => r.id), 'setup: the table has the student').toEqual([rec])
      expect(readXlsxRows((await as(s, s.center, () => table.exportFile(s.tenantId, s.center, { lang: 'ru' }))).file), 'setup: the export has the student').toHaveLength(2)
      await sys(s, () => ctx.prisma.client.center.update({ where: { id: s.t.center.id }, data: { status } }))

      rule(`n9-${status}-roster`, refused403(await outcome(as(s, s.center, () => table.roster(s.tenantId, s.center, {})))), `№9 a ${status} center gets 403 on the table`)
      rule(`n9-${status}-detail`, refused403(await outcome(as(s, s.center, () => table.detail(s.tenantId, s.center, rec)))), `№9 a ${status} center gets 403 on the card`)
      rule(`n9-${status}-export`, refused403(await outcome(as(s, s.center, () => table.exportFile(s.tenantId, s.center, { lang: 'ru' })))), `№9 a ${status} center gets 403 on the Excel export`)

      // Holds today: writes and invitations are refused.
      rule(`n9-${status}-create`, refused403(await outcome(as(s, s.center, () => table.create(s.tenantId, s.center, { fullName: 'Bobur Aliyev', phone: local(phone()), birthDate: '2000-01-02' } as never)))), `№9 a ${status} center adds no student`)
      rule(`n9-${status}-update`, refused403(await outcome(as(s, s.center, () => table.update(s.tenantId, s.center, rec, { status: 'PAUSED' })))), `№9 a ${status} center edits no student`)
      rule(`n9-${status}-invite`, refused403(await outcome(as(s, s.center, () => table.invite(s.tenantId, s.center, rec)))), `№9 a ${status} center sends no invitation`)
    })
  }

  const xlsx = (rows: (string | number)[][]) => buildXlsx('S', ['ФИО', 'Телефон', 'Дата рождения', 'Учебное заведение', 'Класс или курс', 'Группы', 'ФИО родителя', 'Телефон родителя', 'Дата начала'], rows).toString('base64')

  it('№9: a parent name over FULL_NAME_MAX in a row of the file is an error of that row', async () => {
    const s = await setup()
    const ok = 'A'.repeat(FULL_NAME_MAX)
    const long = 'A'.repeat(FULL_NAME_MAX + 1)
    // Setup: the same rows with a parent name at the limit are ready (adult and minor).
    const atLimit = xlsx([['Olim Soliyev', local(phone()), '04.05.2001', '', '', '', ok, '', ''], ['Kamola Ergasheva', '', '01.02.2013', '', '', '', ok, local(phone()), '']])
    expect(await as(s, s.center, () => table.importCheck(s.tenantId, s.center, atLimit)), 'setup: rows at the limit are ready').toMatchObject({ total: 2, ready: 2, errors: [] })
    // Holds today: the student's own name over the limit is a row error.
    const longName = await as(s, s.center, () => table.importCheck(s.tenantId, s.center, xlsx([['B'.repeat(FULL_NAME_MAX + 1), local(phone()), '04.05.2001', '', '', '', '', '', '']])))
    expect(longName.errors.map((e) => e.errors), 'the student\'s name over the limit is a row error').toEqual([['fullName']])

    const overLimit = xlsx([['Olim Soliyev', local(phone()), '04.05.2001', '', '', '', long, '', ''], ['Kamola Ergasheva', '', '01.02.2013', '', '', '', long, local(phone()), '']])
    const check = await as(s, s.center, () => table.importCheck(s.tenantId, s.center, overLimit))
    expect(check.total, 'setup: the file is read').toBe(2)
    rule('n9-import-parentname-check', check.errors.length === 2 && check.errors.every((e) => (e.errors as string[]).includes('parentName')), '№9 a parent name over FULL_NAME_MAX is a row error (check)')
    const count = () => sys(s, () => ctx.prisma.client.centerStudent.count({ where: { centerId: s.t.center.id } }))
    const before = await count()
    const commit = await outcome(as(s, s.center, () => table.importCommit(s.tenantId, s.center, overLimit)))
    rule('n9-import-parentname-commit', refused4xx(commit) && (await count()) === before, '№9 a file with a parent name over FULL_NAME_MAX is not written')
  })
})
