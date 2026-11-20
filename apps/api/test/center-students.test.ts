import { deflateRawSync } from 'node:zlib'
import { INVITE_SENDS_MAX } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crc32, buildXlsx } from '../src/common/xlsx'
import { readXlsxRows, XlsxReadError } from '../src/common/xlsx-read'
import { sha256 } from '../src/common/crypto'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import { CenterStudentsService } from '../src/modules/center/center-students.service'
import { HomeworkService } from '../src/modules/classroom/homework.service'
import { JournalService } from '../src/modules/classroom/journal.service'
import { TenantsService } from '../src/modules/tenants/tenants.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { unzip } from './support/xlsx'

/**
 * ТЗ 2026-11-18 «ILMORA: студенты центров, ДЗ, калькулятор цены», first stage: the center's table of students (4), the
 * invitation (4.3), Excel (4.2), the group journal (5) and homework with text and links (8). Each rule has a test that
 * fails without its code (12.2).
 */

/** A zip of the given parts (stored or deflated) — an .xlsx as Excel writes it, with shared strings, or a broken one. */
function zipOf(parts: { name: string; text?: string; data?: Buffer; deflate?: boolean; declaredSize?: number }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const p of parts) {
    const raw = p.data ?? Buffer.from(p.text ?? '', 'utf8')
    const body = p.deflate === false ? raw : deflateRawSync(raw)
    const method = p.deflate === false ? 0 : 8
    const name = Buffer.from(p.name)
    const size = p.declaredSize ?? raw.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc32(raw), 16)
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += 30 + name.length + body.length
  }
  const size = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}
const WORKBOOK = [
  { name: 'xl/workbook.xml', text: '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId7"/></sheets></workbook>' },
  { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="rId7" Type="t" Target="worksheets/data.xml"/></Relationships>' },
]

describe('Excel reader (no dependency, limits against zip bombs)', () => {
  it('reads shared strings, rich text, inline strings, numbers and skipped cells as Excel writes them', () => {
    const file = zipOf([
      ...WORKBOOK,
      { name: 'xl/sharedStrings.xml', text: '<sst><si><t>ФИО</t></si><si><r><t>Ali</t></r><r><t xml:space="preserve"> Valiyev &amp; Co</t></r></si><si><t/></si></sst>' },
      { name: 'xl/worksheets/data.xml', text: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Telefon</t></is></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>40543</v></c><c r="C3" t="str"><v>=1+1</v></c></row><row r="4"><c r="A4" t="s"><v>2</v></c></row></sheetData></worksheet>' },
    ])
    expect(readXlsxRows(file)).toEqual([{ row: 1, cells: ['ФИО', '', 'Telefon'] }, { row: 3, cells: ['Ali Valiyev & Co', '40543', '=1+1'] }])
  })

  it('reads what our own writer writes', () => {
    expect(readXlsxRows(buildXlsx('S', ['A', 'B'], [['x', 1], ['=HYPERLINK("a")', -2]]))).toEqual([{ row: 1, cells: ['A', 'B'] }, { row: 2, cells: ['x', '1'] }, { row: 3, cells: ['=HYPERLINK("a")', '-2'] }])
  })

  it('refuses a part that unpacks past its limit, whatever size it declares (zip bomb), and too many rows', () => {
    const bomb = zipOf([...WORKBOOK, { name: 'xl/worksheets/data.xml', data: Buffer.alloc(20 * 1024 * 1024, 0x20), declaredSize: 100 }])
    expect(bomb.length).toBeLessThan(100 * 1024)
    expect(() => readXlsxRows(bomb)).toThrow(XlsxReadError)
    try { readXlsxRows(bomb) } catch (err) { expect((err as XlsxReadError).reason).toBe('too_big') }
    const rows = Array.from({ length: 30 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>x</t></is></c></row>`).join('')
    const many = zipOf([...WORKBOOK, { name: 'xl/worksheets/data.xml', text: `<worksheet><sheetData>${rows}</sheetData></worksheet>` }])
    expect(() => readXlsxRows(many, { maxBytes: 1e6, maxEntries: 10, maxEntryBytes: 1e6, maxTotalBytes: 1e7, maxRows: 10, maxCols: 5 })).toThrow(/too_many_rows/)
  })

  it('refuses what is not an .xlsx: another archive, a path out of the package, random bytes', () => {
    expect(() => readXlsxRows(Buffer.from('Rar!\x1a\x07\x00 not a zip'))).toThrow(/not_xlsx/)
    expect(() => readXlsxRows(zipOf([{ name: 'readme.txt', text: 'hi' }]))).toThrow(/not_xlsx/)
    const escape = zipOf([{ name: 'xl/workbook.xml', text: '<workbook><sheets><sheet r:id="rId1"/></sheets></workbook>' }, { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="rId1" Target="../../etc/passwd"/></Relationships>' }])
    expect(() => readXlsxRows(escape)).toThrow(/not_xlsx/)
  })
})

describe.skipIf(!DB_AVAILABLE)('Center students, invitations, journal, homework (ТЗ 2026-11-18)', () => {
  const ctx = new TestContext()
  const table = new CenterStudentsService(ctx.prisma, ctx.audit, new TenantsService(ctx.prisma, ctx.env), ctx.env)
  const journal = new JournalService(ctx.prisma, ctx.audit)
  const homework = new HomeworkService(ctx.prisma, ctx.audit)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const phone = () => `+99893${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
  const local = (p: string) => p.replace('+998', '')
  const err = (p: Promise<unknown>) => p.then(() => 'ok', (e: { getStatus?: () => number; code?: string; response?: { code?: string } }) => `${e.getStatus?.()} ${e.code ?? e.response?.code}`)

  async function setup(label = 'cs') {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    return TenantContext.forTenant(t.tenantId, async () => {
      await db.center.update({ where: { id: t.center.id }, data: { status: 'ACTIVE', approvedAt: new Date() } })
      const admin = await db.user.create({ data: { tenantId: t.tenantId, login: `adm-${t.tenantId}`, displayName: 'Admin', roles: ['CENTER_ADMIN'], centerId: t.center.id } })
      const center: RequestActor = { id: admin.id, roles: ['CENTER_ADMIN'], centerId: t.center.id }
      const teacher: RequestActor = { id: t.teacherUser.id, roles: ['TEACHER'], teacherProfileId: t.teacher.id, centerId: t.center.id }
      return { t, center, teacher, tenantId: t.tenantId }
    })
  }
  type S = Awaited<ReturnType<typeof setup>>
  const as = <T>(s: S, actor: RequestActor, fn: () => Promise<T>) => TenantContext.forTenant(s.tenantId, fn, { actor })
  /** An ILMORA subscriber enrolled in a group (active), as a settled checkout leaves them. */
  async function subscriber(s: S, groupId: string, courseId: string) {
    const user = await ctx.makeStudent(s.tenantId)
    await TenantContext.forTenant(s.tenantId, async () => {
      const sub = await ctx.prisma.client.subscription.create({ data: { tenantId: s.tenantId, studentId: user.id, status: 'ACTIVE' } })
      await ctx.prisma.client.enrollment.create({ data: { tenantId: s.tenantId, subscriptionId: sub.id, studentId: user.id, groupId, courseId, status: 'ACTIVE', enrolledAt: new Date('2026-01-01T00:00:00.000Z') } })
    })
    return user
  }
  const adult = (extra: Record<string, unknown> = {}) => ({ fullName: 'Aziz Karimov', phone: local(phone()), birthDate: '2001-05-04', ...extra })
  const child = (extra: Record<string, unknown> = {}) => ({ fullName: 'Malika Karimova', birthDate: '2013-02-01', parentName: 'Dilnoza Karimova', parentPhone: local(phone()), ...extra })

  // ───────── the table ─────────

  it('table: an adult needs a phone, a minor a parent; one phone per center; only the center\'s own groups', async () => {
    const s = await setup()
    const add = (body: Record<string, unknown>) => as(s, s.center, () => table.create(s.tenantId, s.center, body as never))
    const fields = (p: Promise<unknown>) => p.then(() => [], (e: { response?: { details?: { errors?: string[] } } }) => e.response?.details?.errors ?? ['?'])
    expect(await fields(add(adult({ phone: null })))).toEqual(['phoneRequired'])
    expect(await fields(add(child({ parentName: null, parentPhone: null })))).toEqual(['parentName', 'parentPhone'])
    expect(await fields(add(adult({ phone: '12345' })))).toEqual(['phone'])
    const ok = await add(adult({ groupIds: [s.t.group.id], studyYear: 2, institutionText: 'TATU', institutionType: 'UNIVERSITY' }))
    expect(ok.student).toMatchObject({ source: 'CENTER', minor: false, studyYear: 2, institution: { id: null, name: 'TATU', type: 'UNIVERSITY' }, invite: { state: 'none', sendsLeft: INVITE_SENDS_MAX }, parentConsent: 'adult' })
    expect(ok.student.groups.map((g) => g.id)).toEqual([s.t.group.id])
    const kid = await add(child())
    expect(kid.student).toMatchObject({ minor: true, phone: null, parentConsent: 'waiting' })
    // The same phone twice in one center: 409; another center may have it.
    const p = ok.student.phone!.replace(/\s/g, '')
    expect(await err(add(adult({ phone: p })))).toBe('409 student_phone_taken')
    const other = await setup('cs-other')
    await expect(as(other, other.center, () => table.create(other.tenantId, other.center, adult({ phone: p }) as never))).resolves.toBeTruthy()
    // A group of another center is refused as unknown.
    expect(await fields(add(adult({ groupIds: [other.t.group.id] })))).toEqual(['group'])
    // Who and when in the audit log, never the name or the phone.
    const audit = await TenantContext.forTenant(s.tenantId, () => ctx.prisma.client.auditEvent.findFirstOrThrow({ where: { action: 'center.student_create', entityId: ok.student.id } }))
    expect(audit.actorId).toBe(s.center.id)
    expect(JSON.stringify(audit.after)).not.toMatch(/Aziz|\+998/)
  })

  it('table: «ушёл» moves the record to the archive and back; search and filters', async () => {
    const s = await setup()
    const a = await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ fullName: 'Bobur Aliyev', groupIds: [s.t.group.id] }) as never))
    await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ fullName: 'Sardor Toshev', groupIds: [s.t.group2.id], institutionText: '15-maktab', institutionType: 'SCHOOL' }) as never))
    const list = (q: Record<string, unknown>) => as(s, s.center, () => table.roster(s.tenantId, s.center, q))
    expect((await list({ q: 'bobur' })).rows.map((r) => r.fullName)).toEqual(['Bobur Aliyev'])
    expect((await list({ q: a.student.phone!.replace(/\D/g, '').slice(-7) })).rows.map((r) => r.fullName)).toEqual(['Bobur Aliyev'])
    expect((await list({ groupId: s.t.group2.id })).rows.map((r) => r.fullName)).toEqual(['Sardor Toshev'])
    expect((await list({ institution: 'maktab' })).rows.map((r) => r.fullName)).toEqual(['Sardor Toshev'])
    await as(s, s.center, () => table.update(s.tenantId, s.center, a.student.id, { status: 'LEFT' }))
    expect((await list({})).rows.map((r) => r.fullName)).toEqual(['Sardor Toshev'])
    const archive = await list({ archive: '1' })
    expect(archive.rows).toMatchObject([{ fullName: 'Bobur Aliyev', status: 'LEFT' }])
    expect(archive.rows[0].archivedAt).not.toBeNull()
    await as(s, s.center, () => table.update(s.tenantId, s.center, a.student.id, { status: 'STUDYING' }))
    expect((await list({})).rows.map((r) => r.fullName).sort()).toEqual(['Bobur Aliyev', 'Sardor Toshev'])
  })

  it('ILMORA students appear in the table by themselves (once), keep their details, show a masked phone', async () => {
    const s = await setup()
    const user = await subscriber(s, s.t.group.id, s.t.course.id)
    const first = await as(s, s.center, () => table.roster(s.tenantId, s.center, {}))
    await as(s, s.center, () => table.roster(s.tenantId, s.center, {}))
    const rows = (await as(s, s.center, () => table.roster(s.tenantId, s.center, {}))).rows.filter((r) => r.source === 'ILMORA')
    expect(first.rows.filter((r) => r.source === 'ILMORA')).toHaveLength(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ fullName: user.displayName, linked: true, groups: [{ id: s.t.group.id, via: 'ilmora' }] })
    expect(rows[0].phone).toMatch(/\*\*\*/)
    expect(await err(as(s, s.center, () => table.update(s.tenantId, s.center, rows[0].id, { fullName: 'Boshqa' })))).toBe('422 ilmora_record_readonly')
    expect(await err(as(s, s.center, () => table.invite(s.tenantId, s.center, rows[0].id)))).toBe('422 invite_not_needed')
    await expect(as(s, s.center, () => table.update(s.tenantId, s.center, rows[0].id, { status: 'PAUSED' }))).resolves.toMatchObject({ student: { status: 'PAUSED' } })
  })

  // ───────── invitation ─────────

  it('invitation: 256 random bits, only the SHA-256 stored, in the fragment of the link; to the parent of a minor', async () => {
    const s = await setup()
    const kid = await as(s, s.center, () => table.create(s.tenantId, s.center, child() as never))
    const out = await as(s, s.center, () => table.invite(s.tenantId, s.center, kid.student.id))
    const url = new URL(out.url)
    expect(url.pathname).toBe('/invite')
    expect(url.search).toBe('')
    const token = url.hash.slice(1)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(out).toMatchObject({ to: 'parent', sends: 1, sendsLeft: INVITE_SENDS_MAX - 1 })
    const row = await TenantContext.forTenant(s.tenantId, () => ctx.prisma.client.centerStudent.findFirstOrThrow({ where: { id: kid.student.id } }))
    expect(row.inviteTokenHash).toBe(sha256(token))
    expect(JSON.stringify(row)).not.toContain(token)
    expect(row.inviteExpiresAt!.getTime() - row.invitedAt!.getTime()).toBe(7 * 86_400_000)
    // Never in the audit log either.
    const audits = await TenantContext.forTenant(s.tenantId, () => ctx.prisma.client.auditEvent.findMany({ where: { entityId: kid.student.id } }))
    expect(JSON.stringify(audits)).not.toContain(token)
    // An adult's link goes to the student.
    const grown = await as(s, s.center, () => table.create(s.tenantId, s.center, adult() as never))
    expect((await as(s, s.center, () => table.invite(s.tenantId, s.center, grown.student.id))).to).toBe('student')
  })

  it('invitation: works once, a new link cancels the old one, at most 1 + 3 sends, expires; one answer for all failures', async () => {
    const s = await setup()
    const rec = await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ groupIds: [s.t.group.id] }) as never))
    const send = () => as(s, s.center, () => table.invite(s.tenantId, s.center, rec.student.id)).then((o) => new URL(o.url).hash.slice(1))
    const first = await send()
    const second = await send()
    const student = await ctx.makeStudent(s.tenantId)
    const me: RequestActor = { id: student.id, roles: ['STUDENT'] }
    const accept = (token: string) => as(s, me, () => table.acceptInvite(s.tenantId, me, { token }))
    // The first link is cancelled by the second; a made-up token gets the same answer.
    expect(await err(accept(first))).toBe('422 invite_invalid')
    expect(await err(accept('x'.repeat(43)))).toBe('422 invite_invalid')
    await expect(as(s, me, () => table.invitePreview(second))).resolves.toMatchObject({ fullName: 'Aziz Karimov', groups: [{ name: 'A' }] })
    await expect(as(s, me, () => table.acceptInvite(s.tenantId, me, { token: second, institutionText: '5-maktab', institutionType: 'SCHOOL', studyYear: 9 }))).resolves.toMatchObject({ ok: true })
    // Used once: the same link, by anyone, does not work again; the center sees «принял», the student their center.
    expect(await err(accept(second))).toBe('422 invite_invalid')
    const after = (await as(s, s.center, () => table.detail(s.tenantId, s.center, rec.student.id))).student
    expect(after).toMatchObject({ linked: true, invite: { state: 'accepted' }, studyYear: 9, institution: { name: '5-maktab', type: 'SCHOOL' } })
    expect(await as(s, me, () => table.myCenters(s.tenantId, me))).toMatchObject([{ id: rec.student.id, center: { id: s.t.center.id } }])
    expect(await err(as(s, s.center, () => table.invite(s.tenantId, s.center, rec.student.id)))).toBe('409 invite_accepted')

    // Limit: the first link and 3 more.
    const other = await as(s, s.center, () => table.create(s.tenantId, s.center, adult() as never))
    for (let i = 0; i < INVITE_SENDS_MAX; i++) await as(s, s.center, () => table.invite(s.tenantId, s.center, other.student.id))
    expect(await err(as(s, s.center, () => table.invite(s.tenantId, s.center, other.student.id)))).toBe('409 invite_limit')

    // Expired after 7 days.
    const late = await as(s, s.center, () => table.create(s.tenantId, s.center, adult() as never))
    const token = new URL((await as(s, s.center, () => table.invite(s.tenantId, s.center, late.student.id))).url).hash.slice(1)
    await TenantContext.forTenant(s.tenantId, () => ctx.prisma.client.centerStudent.update({ where: { id: late.student.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } }))
    const another = await ctx.makeStudent(s.tenantId)
    expect(await err(as(s, { id: another.id, roles: ['STUDENT'] }, () => table.acceptInvite(s.tenantId, { id: another.id, roles: ['STUDENT'] }, { token })))).toBe('422 invite_invalid')
    expect((await as(s, s.center, () => table.detail(s.tenantId, s.center, late.student.id))).student.invite.state).toBe('expired')
  })

  it('invitation: an account already on the list cannot take a second record; an ILMORA record gives way to the center\'s one', async () => {
    const s = await setup()
    const user = await subscriber(s, s.t.group.id, s.t.course.id)
    await as(s, s.center, () => table.roster(s.tenantId, s.center, {}))
    const rec = await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ groupIds: [s.t.group2.id] }) as never))
    const token = new URL((await as(s, s.center, () => table.invite(s.tenantId, s.center, rec.student.id))).url).hash.slice(1)
    const me: RequestActor = { id: user.id, roles: ['STUDENT'] }
    await as(s, me, () => table.acceptInvite(s.tenantId, me, { token }))
    const rows = (await as(s, s.center, () => table.roster(s.tenantId, s.center, {}))).rows.filter((r) => r.linked)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: rec.student.id, source: 'CENTER' })
    expect(rows[0].groups.map((g) => `${g.id}:${g.via}`).sort()).toEqual([`${s.t.group.id}:ilmora`, `${s.t.group2.id}:center`].sort())
    // A second record of the same center for the same account: refused.
    const again = await as(s, s.center, () => table.create(s.tenantId, s.center, adult() as never))
    const t2 = new URL((await as(s, s.center, () => table.invite(s.tenantId, s.center, again.student.id))).url).hash.slice(1)
    expect(await err(as(s, me, () => table.acceptInvite(s.tenantId, me, { token: t2 })))).toBe('409 invite_already_member')
    // The student leaves: the record goes to the archive.
    await as(s, me, () => table.leave(s.tenantId, me, rec.student.id))
    expect((await as(s, s.center, () => table.roster(s.tenantId, s.center, { archive: '1' }))).rows.map((r) => r.id)).toContain(rec.student.id)
  })

  it('invitation: a center not approved yet sends none', async () => {
    const s = await setup()
    const rec = await as(s, s.center, () => table.create(s.tenantId, s.center, adult() as never))
    await TenantContext.forTenant(s.tenantId, () => ctx.prisma.client.center.update({ where: { id: s.t.center.id }, data: { status: 'PENDING' } }))
    expect(await err(as(s, s.center, () => table.invite(s.tenantId, s.center, rec.student.id)))).toBe('403 forbidden')
  })

  // ───────── Excel ─────────

  const xlsx = (rows: (string | number)[][]) => buildXlsx('S', ['ФИО', 'Телефон', 'Дата рождения', 'Учебное заведение', 'Класс или курс', 'Группы', 'ФИО родителя', 'Телефон родителя', 'Дата начала'], rows).toString('base64')

  it('Excel: errors per row and nothing written while there is one; a correct file is written whole', async () => {
    const s = await setup()
    const existing = await as(s, s.center, () => table.create(s.tenantId, s.center, adult() as never))
    const taken = existing.student.phone!.replace(/\D/g, '')
    const p1 = phone()
    const bad = xlsx([
      ['Olim Soliyev', local(p1), '04.05.2001', 'TATU', '2 курс', 'A', '', '', '01.09.2025'],
      ['X', '', '2001-05-04', '', '', '', '', '', ''],
      ['Kamola Ergasheva', '', '01.02.2013', '15-maktab', '6', 'Kurs / A', '', '', ''],
      ['Doniyor Rahimov', taken, '04.05.2000', '', '', 'Nope', '', '', ''],
      ['Jasur Bek', local(p1), '31.02.2000', '', '20', 'A; B', '', '', 'вчера'],
    ])
    const check = await as(s, s.center, () => table.importCheck(s.tenantId, s.center, bad))
    expect(check).toMatchObject({ total: 5, ready: 1 })
    expect(Object.fromEntries(check.errors.map((e) => [e.row, e.errors]))).toEqual({
      3: ['fullName', 'phoneRequired'],
      4: ['parentName', 'parentPhone'],
      5: ['phoneTaken', 'group'],
      6: ['birthDate', 'studyYear', 'startedOn', 'phoneTwice'],
    })
    const count = () => TenantContext.forTenant(s.tenantId, () => ctx.prisma.client.centerStudent.count({ where: { centerId: s.t.center.id } }))
    const before = await count()
    expect(await err(as(s, s.center, () => table.importCommit(s.tenantId, s.center, bad)))).toBe('422 import_has_errors')
    expect(await count()).toBe(before)

    const good = xlsx([
      ['Olim Soliyev', `+998 ${local(p1)}`, '04.05.2001', 'TATU', '2 курс', 'A', '', '', '01.09.2025'],
      ['Kamola Ergasheva', '', 41306, '15-maktab', '6', 'Kurs / A; B', 'Ergashev Anvar', local(phone()), ''],
    ])
    await expect(as(s, s.center, () => table.importCommit(s.tenantId, s.center, good))).resolves.toEqual({ created: 2 })
    const rows = (await as(s, s.center, () => table.roster(s.tenantId, s.center, { q: 'Kamola' }))).rows
    expect(rows).toMatchObject([{ fullName: 'Kamola Ergasheva', minor: true, birthDate: '2013-02-01', studyYear: 6, institution: { name: '15-maktab' } }])
    expect(rows[0].groups.map((g) => g.id).sort()).toEqual([s.t.group.id, s.t.group2.id].sort())
    const audit = await TenantContext.forTenant(s.tenantId, () => ctx.prisma.client.auditEvent.findMany({ where: { entityId: s.t.center.id, action: { in: ['center.students_import', 'center.students_import_check'] } }, orderBy: { createdAt: 'asc' } }))
    expect(audit.map((a) => [a.action, (a.after as { rows: number }).rows])).toEqual([['center.students_import_check', 5], ['center.students_import', 2]])
  })

  it('Excel: more than 1000 rows, another format or a bomb — refused whole', async () => {
    const s = await setup()
    const many = xlsx(Array.from({ length: 1001 }, (_, i) => [`Talaba ${i}`, '', '04.05.2001', '', '', '', '', '', '']))
    expect(await err(as(s, s.center, () => table.importCheck(s.tenantId, s.center, many)))).toBe('422 import_too_many_rows')
    expect(await err(as(s, s.center, () => table.importCheck(s.tenantId, s.center, Buffer.from('Rar!\x1a\x07 fake').toString('base64'))))).toBe('422 import_bad_file')
    const bomb = zipOf([...WORKBOOK, { name: 'xl/worksheets/data.xml', data: Buffer.alloc(20 * 1024 * 1024, 0x20), declaredSize: 10 }]).toString('base64')
    expect(await err(as(s, s.center, () => table.importCheck(s.tenantId, s.center, bomb)))).toBe('422 import_bad_file')
    const noHeader = buildXlsx('S', ['Name', 'Phone'], [['x', 'y']]).toString('base64')
    expect(await err(as(s, s.center, () => table.importCheck(s.tenantId, s.center, noHeader)))).toBe('422 import_bad_file')
  })

  it('Excel: the export matches the table (filters too), the template is empty; every download is audited with its rows', async () => {
    const s = await setup()
    await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ fullName: 'Bobur Aliyev', groupIds: [s.t.group.id] }) as never))
    await as(s, s.center, () => table.create(s.tenantId, s.center, child({ fullName: 'Malika Karimova' }) as never))
    const sheet = (file: Buffer) => readXlsxRows(file)
    const all = await as(s, s.center, () => table.exportFile(s.tenantId, s.center, { lang: 'ru' }))
    const rows = sheet(all.file)
    expect(rows[0].cells.slice(0, 3)).toEqual(['ФИО', 'Телефон', 'Дата рождения'])
    expect(rows.slice(1).map((r) => r.cells[0])).toEqual(['Bobur Aliyev', 'Malika Karimova'])
    expect(rows[1].cells[5]).toBe('Курс / A')
    const filtered = await as(s, s.center, () => table.exportFile(s.tenantId, s.center, { lang: 'uz', groupId: s.t.group.id }))
    expect(sheet(filtered.file).slice(1).map((r) => r.cells[0])).toEqual(['Bobur Aliyev'])
    const template = await as(s, s.center, () => table.exportFile(s.tenantId, s.center, { lang: 'en', template: '1' }))
    expect(sheet(template.file)).toHaveLength(1)
    expect(unzip(template.file).get('xl/worksheets/sheet1.xml')).toContain('Full name')
    const audit = await TenantContext.forTenant(s.tenantId, () => ctx.prisma.client.auditEvent.findMany({ where: { entityId: s.t.center.id, action: 'center.students_export' }, orderBy: { createdAt: 'asc' } }))
    expect(audit.map((a) => [a.actorId, (a.after as { rows: number }).rows])).toEqual([[s.center.id, 2], [s.center.id, 1], [s.center.id, 0]])
  })

  // ───────── journal ─────────

  it('journal: the teacher marks the center\'s own students (audited), QR students are read-only, no marks for lessons to come', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const own = await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ groupIds: [s.t.group.id], startedOn: '2026-01-01' }) as never))
    const qrStudent = await subscriber(s, s.t.group.id, s.t.course.id)
    const lesson = (day: string, status: 'COMPLETED' | 'CANCELLED' | 'SCHEDULED' = 'COMPLETED') => TenantContext.forTenant(s.tenantId, () => db.lessonSession.create({ data: { tenantId: s.tenantId, groupId: s.t.group.id, courseId: s.t.course.id, date: new Date(`${day}T00:00:00.000Z`), startsAt: new Date(`${day}T13:00:00.000Z`), endsAt: new Date(`${day}T14:30:00.000Z`), status } }))
    const l1 = await lesson('2026-02-02')
    const l2 = await lesson('2026-02-04')
    const l3 = await lesson('2026-02-06')
    const cancelled = await lesson('2026-02-09', 'CANCELLED')
    const future = await lesson('2099-02-02', 'SCHEDULED')
    await TenantContext.forTenant(s.tenantId, () => db.attendanceRecord.create({ data: { tenantId: s.tenantId, sessionId: l1.id, studentId: qrStudent.id, status: 'PRESENT', method: 'QR', checkedInAt: l1.startsAt } }))
    const mark = (sessionId: string, status: 'PRESENT' | 'ABSENT' | 'LATE' | null, who = s.teacher, centerStudentId = own.student.id) => as(s, who, () => journal.setMark(s.t.group.id, who, { sessionId, centerStudentId, status }))
    await mark(l1.id, 'PRESENT')
    await mark(l2.id, 'LATE')
    await mark(l3.id, 'PRESENT')
    await mark(l3.id, 'ABSENT', s.center)
    expect(await err(mark(cancelled.id, 'PRESENT'))).toBe('422 session_cancelled')
    expect(await err(mark(future.id, 'PRESENT'))).toBe('422 session_not_yet')
    // A center record whose account is in the group through ILMORA is marked by QR only — the teacher cannot.
    const linked = await TenantContext.forTenant(s.tenantId, () => db.centerStudent.create({ data: { tenantId: s.tenantId, centerId: s.t.center.id, fullName: 'QR', userId: qrStudent.id, inviteAcceptedAt: new Date() } }))
    await TenantContext.forTenant(s.tenantId, () => db.centerStudentGroup.create({ data: { tenantId: s.tenantId, centerStudentId: linked.id, groupId: s.t.group.id } }))
    expect(await err(mark(l2.id, 'ABSENT', s.teacher, linked.id))).toBe('403 forbidden')
    expect(await TenantContext.forTenant(s.tenantId, () => db.attendanceRecord.findFirstOrThrow({ where: { sessionId: l1.id, studentId: qrStudent.id } }))).toMatchObject({ status: 'PRESENT', method: 'QR' })

    const view = await as(s, s.teacher, () => journal.journal(s.t.group.id, s.teacher, '2026-02'))
    expect(view.sessions.map((x) => [x.date, x.markable])).toEqual([['2026-02-02', true], ['2026-02-04', true], ['2026-02-06', true], ['2026-02-09', false]])
    const ownRow = view.rows.find((r) => r.id === own.student.id)!
    expect(ownRow).toMatchObject({ kind: 'center', editable: true, attendance: { attended: 2, total: 3, percent: 67 } })
    expect(ownRow.marks[l2.id]).toEqual({ status: 'LATE', method: 'MANUAL' })
    const qrRow = view.rows.find((r) => r.id === qrStudent.id)!
    expect(qrRow).toMatchObject({ kind: 'ilmora', editable: false, attendance: { attended: 1, total: 3 } })
    expect(view.rows.filter((r) => r.name === 'QR')).toEqual([])
    // The table shows the same percent.
    expect((await as(s, s.center, () => table.detail(s.tenantId, s.center, own.student.id))).student.attendance).toEqual({ attended: 2, total: 3, percent: 67 })
    // Every mark and change: who, when, what it was.
    const audit = await TenantContext.forTenant(s.tenantId, () => db.auditEvent.findMany({ where: { entityType: 'CenterAttendanceMark' }, orderBy: { createdAt: 'asc' } }))
    expect(audit.map((a) => [a.action, (a.before as { status?: string } | null)?.status ?? null, (a.after as { status: string }).status])).toEqual([
      ['attendance.center_mark', null, 'PRESENT'], ['attendance.center_mark', null, 'LATE'], ['attendance.center_mark', null, 'PRESENT'], ['attendance.center_mark_change', 'PRESENT', 'ABSENT'],
    ])
    expect(audit[3].actorId).toBe(s.center.id)
    // A lesson before the start date counts once it is marked (the start date is the center's guess).
    const early = await lesson('2025-12-29')
    await mark(early.id, 'ABSENT')
    expect((await as(s, s.center, () => table.detail(s.tenantId, s.center, own.student.id))).student.attendance).toEqual({ attended: 2, total: 4, percent: 50 })
    expect((await as(s, s.teacher, () => journal.journal(s.t.group.id, s.teacher, '2026-02'))).rows.find((r) => r.id === own.student.id)!.attendance).toEqual({ attended: 2, total: 4, percent: 50 })
    await mark(early.id, null)
    // Clearing a mark is a change too.
    await mark(l3.id, null)
    expect(await TenantContext.forTenant(s.tenantId, () => db.centerAttendanceMark.count({ where: { centerStudentId: own.student.id } }))).toBe(2)
    expect((await as(s, s.center, () => table.detail(s.tenantId, s.center, own.student.id))).student.attendance).toEqual({ attended: 2, total: 3, percent: 67 })
  })

  it('journal: another teacher of the same center is refused; a blocked center cannot mark', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const own = await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ groupIds: [s.t.group.id] }) as never))
    const l = await TenantContext.forTenant(s.tenantId, () => db.lessonSession.create({ data: { tenantId: s.tenantId, groupId: s.t.group.id, courseId: s.t.course.id, date: new Date('2026-02-02T00:00:00.000Z'), startsAt: new Date('2026-02-02T13:00:00.000Z'), endsAt: new Date('2026-02-02T14:00:00.000Z'), status: 'COMPLETED' } }))
    const colleague = await TenantContext.forTenant(s.tenantId, async () => {
      const u = await db.user.create({ data: { tenantId: s.tenantId, login: `col-${s.tenantId}`, displayName: 'Colleague', roles: ['TEACHER'], centerId: s.t.center.id } })
      const p = await db.teacherProfile.create({ data: { tenantId: s.tenantId, slug: `col-${s.tenantId}`, name: 'Colleague', title: {}, bio: {}, tagline: {}, centerId: s.t.center.id, userId: u.id } })
      return { id: u.id, roles: ['TEACHER' as const], teacherProfileId: p.id, centerId: s.t.center.id }
    })
    expect(await err(as(s, colleague, () => journal.journal(s.t.group.id, colleague)))).toBe('403 forbidden')
    await TenantContext.forTenant(s.tenantId, () => db.center.update({ where: { id: s.t.center.id }, data: { status: 'BLOCKED' } }))
    expect(await err(as(s, s.teacher, () => journal.setMark(s.t.group.id, s.teacher, { sessionId: l.id, centerStudentId: own.student.id, status: 'PRESENT' })))).toBe('403 forbidden')
  })

  // ───────── homework ─────────

  it('homework: the teacher gives it; subscribers and accepted center students see it; strangers do not', async () => {
    const s = await setup()
    const due = new Date(Date.now() + 86_400_000).toISOString()
    const base = { groupId: s.t.group.id, title: 'Vazifa 1', description: 'Matn va havola https://example.com/task', dueAt: due, submitModes: ['TEXT', 'LINK'] as ('TEXT' | 'LINK')[] }
    expect(await err(as(s, s.teacher, () => homework.create(s.teacher, { ...base, submitModes: ['ZIP'] })))).toBe('422 homework_zip_not_yet')
    expect(await err(as(s, s.teacher, () => homework.create(s.teacher, { ...base, dueAt: new Date(Date.now() - 1000).toISOString() })))).toBe('422 homework_due_past')
    expect(await err(as(s, s.teacher, () => homework.create(s.teacher, { ...base, links: ['javascript:alert(1)'] })))).toBe('422 homework_bad_link')
    expect(await err(as(s, s.teacher, () => homework.create(s.teacher, { ...base, links: ['//evil.example'] })))).toBe('422 homework_bad_link')
    const hw = await as(s, s.teacher, () => homework.create(s.teacher, { ...base, links: ['https://example.com/a'] }))
    // A subscriber of the group, a center student who accepted, one who did not yet, a stranger.
    const sub = await subscriber(s, s.t.group.id, s.t.course.id)
    const rec = await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ groupIds: [s.t.group.id] }) as never))
    const token = new URL((await as(s, s.center, () => table.invite(s.tenantId, s.center, rec.student.id))).url).hash.slice(1)
    const accepted = await ctx.makeStudent(s.tenantId)
    await as(s, { id: accepted.id, roles: ['STUDENT'] }, () => table.acceptInvite(s.tenantId, { id: accepted.id, roles: ['STUDENT'] }, { token }))
    await as(s, s.center, () => table.create(s.tenantId, s.center, adult({ groupIds: [s.t.group.id] }) as never))
    const stranger = await ctx.makeStudent(s.tenantId)
    const list = (id: string) => as(s, { id, roles: ['STUDENT'] }, () => homework.myList({ id, roles: ['STUDENT'] }))
    expect((await list(sub.id)).map((h) => h.id)).toEqual([hw.id])
    expect((await list(accepted.id)).map((h) => h.id)).toEqual([hw.id])
    expect(await list(stranger.id)).toEqual([])
    expect(await err(as(s, { id: stranger.id, roles: ['STUDENT'] }, () => homework.myDetail({ id: stranger.id, roles: ['STUDENT'] }, hw.id)))).toBe('404 not_found')
    const detail = await as(s, s.teacher, () => homework.detail(s.teacher, hw.id))
    expect(detail.students.map((x) => [x.id, x.via, x.state]).sort()).toEqual([[sub.id, 'ilmora', 'missing'], [accepted.id, 'center', 'missing']].sort())
    // The center administrator does not give homework.
    expect(await err(as(s, s.center, () => homework.create(s.center, base)))).toBe('403 forbidden')
  })

  it('homework: hand in and again before the deadline (history kept), not after unless extended; grade and comment', async () => {
    const s = await setup()
    const db = ctx.prisma.client
    const hw = await as(s, s.teacher, () => homework.create(s.teacher, { groupId: s.t.group.id, title: 'Vazifa', description: 'Matn', dueAt: new Date(Date.now() + 3_600_000).toISOString(), submitModes: ['LINK'] }))
    const user = await subscriber(s, s.t.group.id, s.t.course.id)
    const me: RequestActor = { id: user.id, roles: ['STUDENT'] }
    const submit = (body: { text?: string; link?: string }) => as(s, me, () => homework.submit(me, hw.id, body))
    expect(await err(submit({ text: 'matn' }))).toBe('422 homework_mode')
    expect(await err(submit({ link: 'http://example.com' }))).toBe('422 homework_bad_link')
    expect(await err(submit({}))).toBe('422 homework_empty')
    await submit({ link: 'https://github.com/me/site' })
    await submit({ link: 'https://github.com/me/site-v2' })
    const mine = await as(s, me, () => homework.myDetail(me, hw.id))
    expect(mine.submissions.map((x) => x.link)).toEqual(['https://github.com/me/site-v2', 'https://github.com/me/site'])
    expect(mine).toMatchObject({ state: 'submitted', open: true })
    // The deadline passes: no more hand-ins until the teacher extends it for this student.
    await TenantContext.forTenant(s.tenantId, () => db.homework.update({ where: { id: hw.id }, data: { dueAt: new Date(Date.now() - 60_000) } }))
    expect(await err(submit({ link: 'https://github.com/me/late' }))).toBe('422 homework_closed')
    await as(s, s.teacher, () => homework.extend(s.teacher, hw.id, { studentId: user.id, dueAt: new Date(Date.now() + 3_600_000).toISOString() }))
    await submit({ link: 'https://github.com/me/late' })
    const detail = await as(s, s.teacher, () => homework.detail(s.teacher, hw.id))
    expect(detail.students[0]).toMatchObject({ id: user.id, state: 'late', last: { link: 'https://github.com/me/late' } })
    expect(detail.students[0].history).toHaveLength(2)
    // Grade and comment on the latest hand-in; the student sees them.
    await as(s, s.teacher, () => homework.grade(s.teacher, hw.id, { studentId: user.id, grade: 5, comment: 'Zör!' }))
    expect((await as(s, me, () => homework.myDetail(me, hw.id))).submissions[0]).toMatchObject({ grade: 5, comment: 'Zör!' })
    // A homework with hand-ins is not deleted; an outsider cannot be extended.
    expect(await err(as(s, s.teacher, () => homework.remove(s.teacher, hw.id)))).toBe('409 homework_has_submissions')
    const stranger = await ctx.makeStudent(s.tenantId)
    expect(await err(as(s, s.teacher, () => homework.extend(s.teacher, hw.id, { studentId: stranger.id, dueAt: new Date(Date.now() + 3_600_000).toISOString() })))).toBe('422 homework_not_in_group')
    expect(await err(as(s, s.teacher, () => homework.grade(s.teacher, hw.id, { studentId: stranger.id, grade: 3 })))).toBe('422 homework_not_in_group')
  })
})
