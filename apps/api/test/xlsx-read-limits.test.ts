import { deflateRawSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildXlsx, crc32 } from '../src/common/xlsx'
import { readXlsxRows, XlsxReadError } from '../src/common/xlsx-read'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import { CenterStudentsService } from '../src/modules/center/center-students.service'
import { TenantsService } from '../src/modules/tenants/tenants.service'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * Проверка безопасности ILMORA 2026-11-20 (заметка «2026-11-20 Проверка безопасности ILMORA»), находка №1 — импорт
 * учеников центра из Excel (PR #118):
 *
 * 1. `readXlsxRows` (src/common/xlsx-read.ts) ищет строки, ячейки и общие строки ленивыми регулярками `[\s\S]*?` до
 *    закрывающего тега. На листе с незакрытыми `<row>` / `<c>` / `<si>` каждое совпадение просматривает весь остаток
 *    текста — время растёт квадратично и блокирует цикл событий. Файл при этом крошечный (повторы жмутся в килобайты),
 *    лимиты размера его не останавливают. Правило: разбор любого такого файла заканчивается (результатом или
 *    XlsxReadError) за 300 мс. Вызов ждётся через await, так что вынос разбора в worker/Promise сам по себе правило не
 *    закрывает: 300 мс требуют быстрого (линейного) разбора, а не воркера, которого убивают по таймауту через секунды.
 * 2. `importCheck` / `importCommit` (center-students.service.ts) проверяют только assertWritable (BLOCKED/REJECTED), так
 *    что центр на проверке (PENDING) уже импортирует учеников. Правило: центр не одобрен → 403.
 *
 * Пока находка открыта, нарушения закреплены в KNOWN_GAP: тест зелёный и падает, как только правило начнёт
 * соблюдаться — тогда ключ убирают из списка, и правило дальше охраняет исправление. Пока ключ в списке, закреплено и
 * точное сегодняшнее поведение (todayObserved): частичное исправление (например, закрыт только importCheck) тоже
 * поднимает тревогу — ключ надо перепроверить.
 */

const KNOWN_GAP = new Set(['n1-row', 'n1-cell', 'n1-shared', 'n1-pending'])
const CHECKED = new Set<string>()
function rule(key: string, holds: boolean, what: string, todayObserved: boolean) {
  CHECKED.add(key)
  if (KNOWN_GAP.has(key)) {
    expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
    expect(todayObserved, `${what} — behaviour changed from what was pinned on 2026-11-20: re-check the key '${key}'`).toBe(true)
  } else expect(holds, what).toBe(true)
}
afterAll(() => {
  // A KNOWN_GAP key nobody checked is stale (renamed test, skipped suite): it would hide nothing and mislead.
  // The DB suite is skipped without a database, so its key is only required where the DB runs.
  const expected = [...KNOWN_GAP].filter((k) => DB_AVAILABLE || k !== 'n1-pending')
  expect(expected.filter((k) => !CHECKED.has(k)), 'KNOWN_GAP keys never checked').toEqual([])
})

/** A zip of deflated parts — an .xlsx with whatever XML we put in it. */
function zipOf(parts: { name: string; text: string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const p of parts) {
    const raw = Buffer.from(p.text, 'utf8')
    const body = deflateRawSync(raw)
    const name = Buffer.from(p.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(raw), 16)
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += 30 + name.length + body.length
  }
  const size = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

const HEADER_ROW = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Телефон</t></is></c></row>'
const DATA_ROW = '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>901234567</v></c></row>'
const SHARED = '<si><t>ФИО</t></si><si><t>Aziz Karimov</t></si>'
const sheetXml = (rows: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet><sheetData>${rows}</sheetData></worksheet>`
const sharedXml = (items: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst>${items}</sst>`
function workbook(sheet: string, shared: string): Buffer {
  return zipOf([
    { name: 'xl/workbook.xml', text: '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', text: shared },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ])
}

/*
 * Sizes calibrated so that today's code takes a few seconds per file, not minutes (CI time stays bounded).
 * Measured locally (Windows 11, Node 22, the regex alone over N bytes of the repeated tag):
 *   <row>  100 KB → 0.48 s, 150 KB → 3.4 s, 200 KB → 6.1 s, 300 KB → 13.5 s
 *   <c>    100 KB → 1.4 s,  150 KB → 5.8 s, 200 KB → 8.9 s, 300 KB → 25 s
 *   <si>   100 KB → 3.4 s,  150 KB → 5.8 s, 200 KB → 8.2 s, 300 KB → 15 s
 * readXlsxRows on the files below under vitest, today's code (3 runs, same machine), each file ~1.1 KB zipped:
 *   n1-row (150 KB of <row>) 2.4–2.7 s, n1-cell (120 KB of <c>) 2.7–3.1 s, n1-shared (130 KB of <si>) 2.2–2.5 s.
 * The fixed reader must take under 300 ms; the valid file takes ~1 ms.
 */
const ROW_BYTES = 150 * 1024
const CELL_BYTES = 120 * 1024
const SHARED_BYTES = 130 * 1024
const repeat = (tag: string, bytes: number) => tag.repeat(Math.floor(bytes / tag.length))

const VALID = workbook(sheetXml(HEADER_ROW + DATA_ROW), sharedXml(SHARED))
const HEADER = { row: 1, cells: ['ФИО', 'Телефон'] }
const DATA = { row: 2, cells: ['Aziz Karimov', '901234567'] }
/** Each crafted file at a given size of repeats; `small` is what today's reader returns on ~1 KB of them. */
const EVIL: Record<'n1-row' | 'n1-cell' | 'n1-shared', { what: string; bytes: number; build: (bytes: number) => Buffer; small: unknown }> = {
  'n1-row': { what: 'sheet: the header and then unclosed <row> tags', bytes: ROW_BYTES, build: (n) => workbook(sheetXml(HEADER_ROW + repeat('<row>', n)), sharedXml(SHARED)), small: [HEADER] },
  'n1-cell': { what: 'sheet: a row of unclosed <c> tags', bytes: CELL_BYTES, build: (n) => workbook(sheetXml(HEADER_ROW + `<row r="2">${repeat('<c>', n)}</row>`), sharedXml(SHARED)), small: [HEADER] },
  'n1-shared': { what: 'sharedStrings: unclosed <si> tags', bytes: SHARED_BYTES, build: (n) => workbook(sheetXml(HEADER_ROW + DATA_ROW), sharedXml(SHARED + repeat('<si>', n))), small: [HEADER, DATA] },
}
const LIMIT_MS = 300

describe('Excel reader: a crafted file is read in bounded time (проверка 20.11 №1)', () => {
  it('sanity: the valid file parses as written; every crafted file is small and reaches the tag scanning', () => {
    expect(readXlsxRows(VALID)).toEqual([HEADER, DATA])
    for (const { build, bytes, small } of Object.values(EVIL)) {
      // The attack is not about size: each crafted file is a few KB, far below the 512 KB the import accepts.
      expect(build(bytes).length).toBeLessThan(16 * 1024)
      // At ~1 KB of repeats the same file is read quickly and its header comes out: the zip, workbook and rels are
      // fine and the reader really gets to the sheet/shared-strings scanning the big file attacks.
      expect(readXlsxRows(build(1024))).toEqual(small)
    }
  })

  for (const [key, { what, bytes, build }] of Object.entries(EVIL)) {
    it(`${key}: ${what} — finishes within ${LIMIT_MS} ms`, async () => {
      const file = build(bytes)
      const started = performance.now()
      let outcome: string
      try {
        // Awaited, so a fix that returns a Promise (worker, async parse) is timed to its end, not to its start.
        await Promise.resolve(readXlsxRows(file))
        outcome = 'returned'
      } catch (err) {
        if (!(err instanceof XlsxReadError)) throw err
        outcome = `XlsxReadError(${err.reason})`
      }
      const ms = performance.now() - started
      console.info(`[20.11 №1] ${key}: ${outcome} in ${ms.toFixed(0)} ms (file ${file.length} bytes)`)
      // Today: the reader returns (no error) after seconds.
      rule(key, ms < LIMIT_MS, `${what}: readXlsxRows → ${outcome} in ${ms.toFixed(0)} ms, limit ${LIMIT_MS} ms`, outcome === 'returned' && ms >= LIMIT_MS)
    }, 60_000)
  }
})

describe.skipIf(!DB_AVAILABLE)('Excel import: only an approved center imports students (проверка 20.11 №1)', () => {
  const ctx = new TestContext()
  const table = new CenterStudentsService(ctx.prisma, ctx.audit, new TenantsService(ctx.prisma, ctx.env), ctx.env)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  async function setup(label: string, status: 'ACTIVE' | 'PENDING') {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    return TenantContext.forTenant(t.tenantId, async () => {
      await db.center.update({ where: { id: t.center.id }, data: { status, approvedAt: status === 'ACTIVE' ? new Date() : null } })
      const admin = await db.user.create({ data: { tenantId: t.tenantId, login: `adm-${t.tenantId}`, displayName: 'Admin', roles: ['CENTER_ADMIN'], centerId: t.center.id } })
      const center: RequestActor = { id: admin.id, roles: ['CENTER_ADMIN'], centerId: t.center.id }
      return { t, center, tenantId: t.tenantId }
    })
  }
  type S = Awaited<ReturnType<typeof setup>>
  const as = <T>(s: S, fn: () => Promise<T>) => TenantContext.forTenant(s.tenantId, fn, { actor: s.center })
  /** 'ok' or '<HTTP status> <code>'; anything that is not an HTTP error (TypeError, Prisma) fails the test as it is. */
  const status = (p: Promise<unknown>) => p.then(() => 'ok', (e: { getStatus?: () => number; code?: string; response?: { code?: string } }) => {
    if (typeof e?.getStatus !== 'function') throw e
    return `${e.getStatus()} ${e.code ?? e.response?.code}`
  })
  const phone = () => `93${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
  const file = () => buildXlsx('S', ['ФИО', 'Телефон', 'Дата рождения', 'Учебное заведение', 'Класс или курс', 'Группы', 'ФИО родителя', 'Телефон родителя', 'Дата начала'], [
    ['Olim Soliyev', phone(), '04.05.2001', '', '', '', '', '', ''],
  ]).toString('base64')
  const count = (s: S) => TenantContext.forTenant(s.tenantId, () => ctx.prisma.client.centerStudent.count({ where: { centerId: s.t.center.id } }))

  it('sanity: an ACTIVE center checks and imports the file', async () => {
    const s = await setup('xl-active', 'ACTIVE')
    const f = file()
    await expect(as(s, () => table.importCheck(s.tenantId, s.center, f))).resolves.toMatchObject({ total: 1, ready: 1 })
    await expect(as(s, () => table.importCommit(s.tenantId, s.center, f))).resolves.toEqual({ created: 1 })
    expect(await count(s)).toBe(1)
  })

  it('n1-pending: a PENDING (not approved) center gets 403 on importCheck and importCommit, nothing written', async () => {
    const s = await setup('xl-pending', 'PENDING')
    const f = file()
    const check = await status(as(s, () => table.importCheck(s.tenantId, s.center, f)))
    const commit = await status(as(s, () => table.importCommit(s.tenantId, s.center, f)))
    const written = await count(s)
    console.info(`[20.11 №1] n1-pending: importCheck → ${check}, importCommit → ${commit}, students written: ${written}`)
    // Outside the rule: each call either went through or was refused with 403 — never another error.
    for (const outcome of [check, commit]) expect(outcome === 'ok' || outcome.startsWith('403'), `unexpected outcome: ${outcome}`).toBe(true)
    rule('n1-pending', check.startsWith('403') && commit.startsWith('403') && written === 0, `PENDING center: importCheck → ${check}, importCommit → ${commit}, written ${written}`,
      // Today (2026-11-20): both calls go through and the student is written. Guarding only one of them changes this.
      check === 'ok' && commit === 'ok' && written === 1)
  })
})
