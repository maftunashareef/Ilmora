import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum'
import { CUSTOM_ROUTE_ARGS_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { FULL_NAME_MAX, OFFER_VERSION } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomToken } from '../src/common/crypto'
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
 *      телефоном родителя (несовершеннолетний), не получает запись: она остаётся непривязанной, а ответ — 4xx или
 *      «ждёт подтверждения» (центр не может отличить чужого от владельца, пока не подтвердит). В предпросмотре такой
 *      аккаунт не видит данных студента (можно только название центра): ни ФИО, ни учебного заведения, ни
 *      курса/класса, ни групп. Способ привязки не решён (совпадение телефона, SMS-код, подтверждение центром), поэтому
 *      правило проверяет только исход. Аккаунт с совпадающим телефоном по-прежнему принимает — или получает исход «ждёт
 *      подтверждения»: ответ без `ok: true` или с `pending: true`, либо 4xx с одним из кодов PENDING_CODES (список уточнить под выбранное исправление).
 *      Исправление, которое пишет userId в запись ДО подтверждения, под правило не подходит (запись должна остаться
 *      непривязанной, пока шаг не пройден).
 *  №3  Центр видит полную дату рождения студентов, пришедших через ILMORA (и несовершеннолетних): для записей с
 *      source ILMORA ни таблица, ни карточка, ни выгрузка Excel не содержат даты рождения. Флаг «несовершеннолетний»
 *      или возраст — можно, а флаг `minor` у несовершеннолетнего обязан остаться (проверяется строго). Показ только года рождения намеренно не
 *      принимается: правило ищет полную дату, но решение по находке — дату не отдавать.
 *  №4  Выданное приглашение переживает смену телефона и архив: после смены phone / parentPhone или статуса LEFT старая
 *      ссылка отвечает так же, как несуществующая (тот же статус и код, что у случайного токена), и запись не
 *      привязывается; запись в статусе LEFT не принимается вовсе. Сравнение с «мёртвой» ссылкой нужно, чтобы отказ из-за
 *      лишнего шага №2 (SMS-код, подтверждение) не выдавал себя за закрытие №4.
 *  №9  Заблокированный или отклонённый центр (BLOCKED / REJECTED) не читает и не выгружает студентов (таблица,
 *      карточка, Excel — 403); ФИО родителя длиннее FULL_NAME_MAX в строке файла — ошибка строки.
 *      Лимит записей на ещё не одобренный центр здесь не проверяется (не решён; см. PR).
 *
 * Предпросмотр и принятие идут через настоящий обработчик StudentCentersController (параметры из метаданных маршрута),
 * но без guard'ов и interceptor'ов Nest: исправление, сделанное только guard'ом, этот тест не увидит.
 *
 * KNOWN_GAP — правила, которые код PR #118 сегодня нарушает (каждое сверено с кодом). Пока ключ в списке, тест требует,
 * чтобы правило НЕ выполнялось И чтобы наблюдалось ровно сегодняшнее поведение (todayObserved) — так и исправление, и
 * поломка сценария валят тест. Сценарий обязан реально работать (проверки «setup» вне rule()). Когда находку закроют,
 * тест упадёт с подсказкой убрать ключ — с этого момента правило требуется строго. Ошибка, не являющаяся HTTP-ответом
 * (TypeError и т. п.), всегда валит тест, а не засчитывается как «дыра открыта».
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
const checked = new Set<string>()
function rule(key: string, holds: boolean, what: string, todayObserved: boolean) {
  checked.add(key)
  if (KNOWN_GAP.has(key)) {
    expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
    expect(todayObserved, `${what} — '${key}' no longer behaves as on 20.11 (fix or broken scenario): check the rule and KNOWN_GAP`).toBe(true)
  } else expect(holds, what).toBe(true)
}

type Outcome = { ok: true; value: unknown } | { ok: false; status: number; code: string | undefined }
/** An HTTP answer; anything else (TypeError, a broken test helper) is rethrown and fails the test. */
const outcome = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (e: { getStatus?: () => number; code?: string; response?: { code?: string } }) => {
      if (typeof e?.getStatus !== 'function') throw e
      return { ok: false as const, status: e.getStatus(), code: e.code ?? e.response?.code }
    },
  )
const refused4xx = (o: Outcome) => !o.ok && o.status >= 400 && o.status < 500
const refused403 = (o: Outcome) => !o.ok && o.status === 403
/** «Waiting for confirmation»: an answer that is not a plain `{ ok: true }`, or a 4xx naming the missing step. */
/** TODO(№2): exact codes of the confirmation step, to be aligned with the fix that is chosen (SMS code, center confirmation). */
const PENDING_CODES = new Set(['invite_pending', 'invite_code_required', 'invite_confirmation_required', 'invite_sms_required', 'invite_otp_required', 'code_required', 'confirmation_required'])
const isPending = (o: Outcome) => {
  if (o.ok) { const v = (o.value ?? {}) as { ok?: unknown; pending?: unknown }; return v.ok !== true || v.pending === true }
  return refused4xx(o) && PENDING_CODES.has(o.code ?? '')
}
/** The same answer as a link that never existed. */
const sameAsDead = (o: Outcome, dead: Outcome) => !o.ok && !dead.ok && o.status === dead.status && o.code === dead.code

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
  afterAll(async () => {
    await ctx.close()
    expect([...KNOWN_GAP].filter((k) => !checked.has(k)), 'every KNOWN_GAP key was checked by a test').toEqual([])
  })

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
   * whatever the fix adds to the handler's signature. Guards and interceptors are not run.
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

  /** The answers to a malformed body (validation, not the service). */
  const malformed = async (s: S, actor: RequestActor) => {
    const m = { preview: await preview(s, actor, '!'), accept: await accept(s, actor, '!') }
    expect(refused4xx(m.preview) && refused4xx(m.accept), 'setup: a malformed body is refused').toBe(true)
    return m
  }
  /** A refusal by the service: a 4xx that is not the body-validation answer. */
  const refusedByService = (o: Outcome, bad: Outcome) => refused4xx(o) && !sameAsDead(o, bad)

  /** Setup: the link is alive for its owner — the preview names the center, or asks for the confirmation step. */
  const previewWorks = (o: Outcome, s: S) => (o.ok && (o.value as { centerName?: string } | null)?.centerName === s.t.center.name) || (refused4xx(o) && isPending(o))
  /** Today's preview: answered with the student's full name in it. */
  const previewShowsName = (o: Outcome, fullName: string) => o.ok && JSON.stringify(o.value).includes(fullName)

  /** Fields of the student that a stranger must not see in the preview. */
  const STUDENT_FIELDS = ['fullName', 'institution', 'studyYear', 'groups'] as const
  const showsStudent = (o: Outcome, fullName: string) => {
    if (!o.ok) return false
    const v = (o.value ?? {}) as Record<string, unknown>
    const present = STUDENT_FIELDS.some((f) => { const x = v[f]; return x !== undefined && x !== null && !(Array.isArray(x) && !x.length) })
    return present || JSON.stringify(v).includes(fullName)
  }

  // ───────── №2 ─────────

  it('№2: a stranger account neither takes the record nor sees the student in the preview; the matching phone still accepts', async () => {
    const s = await setup()
    const adultPhone = phone()
    const rec = await create(s, { fullName: 'Aziz Karimov', phone: local(adultPhone), birthDate: '2001-05-04', groupIds: [s.t.group.id], studyYear: 2, institutionText: 'TATU', institutionType: 'UNIVERSITY' })
    const token = await invite(s, rec)
    expect((await record(s, rec)).inviteTokenHash, 'setup: the invitation was issued').toBeTruthy()
    const stranger = await account(s, phone(), 'Stranger')
    const owner = await account(s, adultPhone, 'Owner')

    expect(previewWorks(await preview(s, owner, token), s), 'setup: the owner opens the preview').toBe(true)

    const seen = await preview(s, stranger, token)
    const allShown = seen.ok && STUDENT_FIELDS.every((f) => { const x = (seen.value as Record<string, unknown>)[f]; return x !== undefined && x !== null && !(Array.isArray(x) && !x.length) })
    rule('n2-preview', !showsStudent(seen, 'Aziz Karimov'), '№2 a stranger\'s preview shows no fullName / institution / studyYear / groups', allShown && previewShowsName(seen, 'Aziz Karimov'))

    const bad = await malformed(s, stranger)
    const taken = await accept(s, stranger, token)
    const after = await record(s, rec)
    rule('n2-accept', after.userId === null && (refusedByService(taken, bad.accept) || isPending(taken)), '№2 a stranger does not get the record: unlinked, and 4xx or «waiting for confirmation»', taken.ok && after.userId === stranger.id)

    // The matching phone accepts (a second record: a stranger's accept above uses the first link today).
    const phone2 = phone()
    const rec2 = await create(s, { fullName: 'Bobur Aliyev', phone: local(phone2), birthDate: '2000-01-02' })
    const token2 = await invite(s, rec2)
    const rightful = await account(s, phone2, 'Rightful')
    const res = await accept(s, rightful, token2)
    const linked = (await record(s, rec2)).userId
    if (isPending(res)) expect(linked, '№2 «waiting for confirmation»: not linked yet').toBeNull()
    else {
      expect(res, '№2 the account with the record\'s phone still accepts').toMatchObject({ ok: true, value: { ok: true } })
      expect(linked, '№2 the record is linked to the account that accepted').toBe(rightful.id)
    }
  })

  it('№2: a stranger account cannot take a minor\'s record (the link goes to the parent\'s phone)', async () => {
    const s = await setup()
    const rec = await create(s, { fullName: 'Malika Karimova', birthDate: '2013-02-01', parentName: 'Dilnoza Karimova', parentPhone: local(phone()), groupIds: [s.t.group.id] })
    const token = await invite(s, rec)
    const stranger = await account(s, phone(), 'Stranger')
    expect((await record(s, rec)).inviteTokenHash, 'setup: the invitation was issued').toBeTruthy()
    const bad = await malformed(s, stranger)
    const taken = await accept(s, stranger, token)
    const after = await record(s, rec)
    rule('n2-accept-minor', after.userId === null && (refusedByService(taken, bad.accept) || isPending(taken)), '№2 a stranger does not get a minor\'s record', taken.ok && after.userId === stranger.id)
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
    const isoBirths = births.map(([, iso]) => iso).sort()
    const kidRow = mine.find((r) => (r as { fullName: string }).fullName.startsWith('Ilmora kid'))
    expect((kidRow as { minor?: unknown } | undefined)?.minor, '№3 the minor flag stays for the minor').toBe(true)
    rule('n3-roster', mine.every((r) => !rowBirth(r)) && !births.some(([, iso, dmy]) => has(roster, iso, dmy)), '№3 the table has no birth date of ILMORA students', JSON.stringify(mine.map(rowBirth).sort()) === JSON.stringify(isoBirths))

    const cards = await Promise.all(mine.map((r) => as(s, s.center, () => table.detail(s.tenantId, s.center, r.id))))
    expect(cards.map((c) => c.student.source), 'setup: the cards open').toEqual(['ILMORA', 'ILMORA'])
    rule('n3-detail', cards.every((c) => !rowBirth(c.student)) && !births.some(([, iso, dmy]) => has(cards, iso, dmy)), '№3 the card has no birth date of an ILMORA student', JSON.stringify(cards.map((c) => rowBirth(c.student)).sort()) === JSON.stringify(isoBirths))

    const file = await as(s, s.center, () => table.exportFile(s.tenantId, s.center, { lang: 'ru' }))
    const sheet = readXlsxRows(file.file)
    expect(sheet.length, 'setup: the export has the two students').toBe(3)
    const cells = sheet.slice(1).flatMap((r) => r.cells)
    rule('n3-excel', !births.some(([, iso, dmy]) => cells.some((c) => c.includes(iso) || c.includes(dmy))), '№3 the Excel export has no birth date of ILMORA students', births.every(([, , dmy]) => cells.includes(dmy)))
  })

  // ───────── №4 ─────────

  /** The answers to a link that never existed, for the same account. */
  /**
   * The answers to a link that never existed, for the same account. Setup proves they come from the service, not from
   * body validation: a malformed body (or one missing a field a fix makes required) gets another answer.
   */
  const dead = async (s: S, actor: RequestActor) => {
    const d = { preview: await preview(s, actor, randomToken(32)), accept: await accept(s, actor, randomToken(32)) }
    const bad = await malformed(s, actor)
    expect(refused4xx(d.preview) && refused4xx(d.accept), 'setup: a dead link is refused').toBe(true)
    expect(sameAsDead(d.preview, bad.preview), 'setup: the dead-link preview answer is the service\'s, not body validation\'s').toBe(false)
    expect(sameAsDead(d.accept, bad.accept), 'setup: the dead-link accept answer is the service\'s, not body validation\'s').toBe(false)
    return d
  }

  it('№4: after the student\'s phone changes, the old link answers as a dead one (for the new phone too)', async () => {
    const s = await setup()
    const oldPhone = phone()
    const rec = await create(s, { fullName: 'Aziz Karimov', phone: local(oldPhone), birthDate: '2001-05-04' })
    const token = await invite(s, rec)
    expect(previewWorks(await preview(s, await account(s, oldPhone, 'Old phone'), token), s), 'setup: the link works before the change').toBe(true)
    // The account of the NEW phone tries the old link: whatever binding №2 brings, it matches the record now.
    const newPhone = phone()
    const holder = await account(s, newPhone, 'New phone')
    const d = await dead(s, holder)
    await as(s, s.center, () => table.update(s.tenantId, s.center, rec, { phone: local(newPhone) }))
    expect((await record(s, rec)).phoneE164, 'setup: the phone changed').toBe(newPhone)
    const pv = await preview(s, holder, token)
    rule('n4-phone-preview', sameAsDead(pv, d.preview), '№4 the old link previews as a dead one after a phone change', previewShowsName(pv, 'Aziz Karimov'))
    const res = await accept(s, holder, token)
    const after = await record(s, rec)
    rule('n4-phone-accept', sameAsDead(res, d.accept) && after.userId === null, '№4 the old link is refused as a dead one after a phone change', res.ok && after.userId === holder.id)
  })

  it('№4: after a minor\'s parent phone changes, the old link answers as a dead one', async () => {
    const s = await setup()
    const oldParent = phone()
    const rec = await create(s, { fullName: 'Malika Karimova', birthDate: '2013-02-01', parentName: 'Dilnoza Karimova', parentPhone: local(oldParent) })
    const token = await invite(s, rec)
    expect(previewWorks(await preview(s, await account(s, oldParent, 'Old parent phone'), token), s), 'setup: the link works before the change').toBe(true)
    const newParent = phone()
    const holder = await account(s, newParent, 'New parent phone')
    const d = await dead(s, holder)
    await as(s, s.center, () => table.update(s.tenantId, s.center, rec, { parentPhone: local(newParent) }))
    expect((await record(s, rec)).parentPhoneE164, 'setup: the parent phone changed').toBe(newParent)
    const pv = await preview(s, holder, token)
    rule('n4-parent-preview', sameAsDead(pv, d.preview), '№4 the old link previews as a dead one after a parent phone change', previewShowsName(pv, 'Malika Karimova'))
    const res = await accept(s, holder, token)
    const after = await record(s, rec)
    rule('n4-parent-accept', sameAsDead(res, d.accept) && after.userId === null, '№4 the old link is refused as a dead one after a parent phone change', res.ok && after.userId === holder.id)
  })

  it('№4: a record sent to the archive (LEFT) is not accepted, whether by the old link or with a link still on it', async () => {
    const s = await setup()
    const p = phone()
    const rec = await create(s, { fullName: 'Aziz Karimov', phone: local(p), birthDate: '2001-05-04' })
    const token = await invite(s, rec)
    const owner = await account(s, p, 'Owner')
    expect(previewWorks(await preview(s, owner, token), s), 'setup: the link works before the archive').toBe(true)
    const d = await dead(s, owner)
    await as(s, s.center, () => table.update(s.tenantId, s.center, rec, { status: 'LEFT' }))
    expect((await record(s, rec)).status, 'setup: the record is in the archive').toBe('LEFT')
    const pv = await preview(s, owner, token)
    rule('n4-left-preview', sameAsDead(pv, d.preview), '№4 the link of an archived record previews as a dead one', previewShowsName(pv, 'Aziz Karimov'))
    const res = await accept(s, owner, token)
    const after = await record(s, rec)
    rule('n4-left-accept', sameAsDead(res, d.accept) && after.userId === null, '№4 the link of an archived record is refused as a dead one', res.ok && after.userId === owner.id)

    // A LEFT record that still carries a live token (however it got there) is refused at accept time too.
    const p2 = phone()
    const rec2 = await create(s, { fullName: 'Bobur Aliyev', phone: local(p2), birthDate: '2000-01-02' })
    const token2 = await invite(s, rec2)
    await sys(s, () => ctx.prisma.client.centerStudent.update({ where: { id: rec2 }, data: { status: 'LEFT', archivedAt: new Date() } }))
    const live = await record(s, rec2)
    expect(live.inviteTokenHash && live.inviteExpiresAt!.getTime() > Date.now(), 'setup: the token is still on the archived record').toBeTruthy()
    const owner2 = await account(s, p2, 'Owner 2')
    const d2 = await dead(s, owner2)
    const res2 = await accept(s, owner2, token2)
    const after2 = await record(s, rec2)
    rule('n4-left-direct-accept', sameAsDead(res2, d2.accept) && after2.userId === null, '№4 a LEFT record is refused as a dead link', res2.ok && after2.userId === owner2.id)
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

      const roster = await outcome(as(s, s.center, () => table.roster(s.tenantId, s.center, {})))
      rule(`n9-${status}-roster`, refused403(roster), `№9 a ${status} center gets 403 on the table`, roster.ok && (roster.value as { rows: { id: string }[] }).rows.some((r) => r.id === rec))
      const detail = await outcome(as(s, s.center, () => table.detail(s.tenantId, s.center, rec)))
      rule(`n9-${status}-detail`, refused403(detail), `№9 a ${status} center gets 403 on the card`, detail.ok && (detail.value as { student: { id: string } }).student.id === rec)
      const exported = await outcome(as(s, s.center, () => table.exportFile(s.tenantId, s.center, { lang: 'ru' })))
      rule(`n9-${status}-export`, refused403(exported), `№9 a ${status} center gets 403 on the Excel export`, exported.ok && readXlsxRows((exported.value as { file: Buffer }).file).length === 2)

      // Holds today: writes and invitations are refused.
      const createO = await outcome(as(s, s.center, () => table.create(s.tenantId, s.center, { fullName: 'Bobur Aliyev', phone: local(phone()), birthDate: '2000-01-02' } as never)))
      rule(`n9-${status}-create`, refused403(createO), `№9 a ${status} center adds no student`, refused403(createO))
      const updateO = await outcome(as(s, s.center, () => table.update(s.tenantId, s.center, rec, { status: 'PAUSED' })))
      rule(`n9-${status}-update`, refused403(updateO), `№9 a ${status} center edits no student`, refused403(updateO))
      const inviteO = await outcome(as(s, s.center, () => table.invite(s.tenantId, s.center, rec)))
      rule(`n9-${status}-invite`, refused403(inviteO), `№9 a ${status} center sends no invitation`, refused403(inviteO))
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
    rule('n9-import-parentname-check', check.errors.length === 2 && check.errors.every((e) => e.errors.length > 0), '№9 a parent name over FULL_NAME_MAX is a row error (check)', check.errors.length === 0)
    const count = () => sys(s, () => ctx.prisma.client.centerStudent.count({ where: { centerId: s.t.center.id } }))
    const before = await count()
    const commit = await outcome(as(s, s.center, () => table.importCommit(s.tenantId, s.center, overLimit)))
    const afterCount = await count()
    rule('n9-import-parentname-commit', refused4xx(commit) && afterCount === before, '№9 a file with a parent name over FULL_NAME_MAX is not written', commit.ok && afterCount === before + 2)
  })
})
