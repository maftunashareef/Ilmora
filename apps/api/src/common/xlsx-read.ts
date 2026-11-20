import { inflateRawSync } from 'node:zlib'

/**
 * A minimal Excel (.xlsx) reader for imports (ТЗ 2026-11-18, 4.2 «загрузить из Excel»): the first sheet as rows of
 * cell text, without a dependency. The file comes from a person, so it is read with limits — the file size, the number
 * of entries in the zip, the size each entry and all of them unpack to — and an entry that unpacks past its limit
 * stops the read (a «zip bomb» never reaches memory whole). Only the four parts a sheet needs are unpacked; nothing is
 * written to disk; formulas are never evaluated (a cell's stored value is read as text).
 */

export class XlsxReadError extends Error {
  constructor(public readonly reason: 'not_xlsx' | 'too_big' | 'too_many_rows' | 'encrypted') {
    super(`xlsx: ${reason}`)
  }
}

export interface XlsxLimits {
  /** The file itself. */
  maxBytes: number
  /** Entries in the zip's directory. */
  maxEntries: number
  /** What one unpacked part may weigh. */
  maxEntryBytes: number
  /** All unpacked parts together. */
  maxTotalBytes: number
  /** Rows of the sheet with anything in them, the header included. */
  maxRows: number
  /** Columns read per row (the rest is ignored). */
  maxCols: number
}

export const DEFAULT_XLSX_LIMITS: XlsxLimits = { maxBytes: 512 * 1024, maxEntries: 200, maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024, maxRows: 1001, maxCols: 40 }

/** Control characters other than tab, line feed and carriage return: a cell keeps none of them. */
const stripControl = (s: string): string => Array.from(s).filter((ch) => { const c = ch.charCodeAt(0); return c > 31 || c === 9 || c === 10 || c === 13 }).join('')

interface Entry { name: string; method: number; flags: number; compressedSize: number; size: number; localOffset: number }

function directory(buf: Buffer, limits: XlsxLimits): Map<string, Entry> {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new XlsxReadError('not_xlsx')
  // The end-of-directory record is in the last 22 bytes plus a comment of at most 65535.
  let eocd = -1
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 22 - 65_535); p--) if (buf.readUInt32LE(p) === 0x06054b50) { eocd = p; break }
  if (eocd < 0) throw new XlsxReadError('not_xlsx')
  const count = buf.readUInt16LE(eocd + 10)
  const size = buf.readUInt32LE(eocd + 12)
  const offset = buf.readUInt32LE(eocd + 16)
  if (count > limits.maxEntries) throw new XlsxReadError('too_big')
  if (offset + size > eocd) throw new XlsxReadError('not_xlsx')
  const out = new Map<string, Entry>()
  let p = offset
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxReadError('not_xlsx')
    const nameLen = buf.readUInt16LE(p + 28)
    const extra = buf.readUInt16LE(p + 30)
    const comment = buf.readUInt16LE(p + 32)
    const entry: Entry = {
      flags: buf.readUInt16LE(p + 8), method: buf.readUInt16LE(p + 10), compressedSize: buf.readUInt32LE(p + 20), size: buf.readUInt32LE(p + 24),
      localOffset: buf.readUInt32LE(p + 42), name: buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
    }
    out.set(entry.name.replace(/^\/+/, ''), entry)
    p += 46 + nameLen + extra + comment
  }
  return out
}

function unpack(buf: Buffer, e: Entry, limits: XlsxLimits, budget: { left: number }): string {
  if (e.flags & 0x1) throw new XlsxReadError('encrypted')
  if (e.size > limits.maxEntryBytes || e.size > budget.left) throw new XlsxReadError('too_big')
  const p = e.localOffset
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new XlsxReadError('not_xlsx')
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28)
  if (start + e.compressedSize > buf.length) throw new XlsxReadError('not_xlsx')
  const data = buf.subarray(start, start + e.compressedSize)
  let out: Buffer
  if (e.method === 0) out = Buffer.from(data)
  else if (e.method === 8) {
    try {
      // The declared size may lie: the unpacked output is capped whatever it says.
      out = inflateRawSync(data, { maxOutputLength: Math.min(limits.maxEntryBytes, budget.left) })
    } catch (err) {
      throw new XlsxReadError((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError ? 'too_big' : 'not_xlsx')
    }
  } else throw new XlsxReadError('not_xlsx')
  budget.left -= out.length
  return out.toString('utf8')
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITY[e.toLowerCase()] ?? m
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  })
/** The text of a run of <t> elements (rich text keeps its pieces; phonetic hints are dropped). */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => decode(m[1] ?? '')).join('')
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1]

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? ''
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** The first sheet of the workbook as rows of trimmed cell text (empty rows dropped, the row number kept). */
export function readXlsxRows(buf: Buffer, limits: XlsxLimits = DEFAULT_XLSX_LIMITS): { row: number; cells: string[] }[] {
  if (buf.length > limits.maxBytes) throw new XlsxReadError('too_big')
  const entries = directory(buf, limits)
  const budget = { left: limits.maxTotalBytes }
  const part = (name: string) => {
    const e = entries.get(name)
    return e ? unpack(buf, e, limits, budget) : null
  }
  const workbook = part('xl/workbook.xml')
  if (!workbook) throw new XlsxReadError('not_xlsx')
  const firstSheet = workbook.match(/<sheet\b([^>]*)\/?>/)
  const relId = firstSheet ? (attr(firstSheet[1], 'r:id') ?? attr(firstSheet[1], 'id')) : undefined
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const rels = part('xl/_rels/workbook.xml.rels')
  if (relId && rels) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      if (attr(m[1], 'Id') !== relId) continue
      const target = attr(m[1], 'Target') ?? ''
      sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    }
  }
  if (sheetPath.includes('..')) throw new XlsxReadError('not_xlsx')
  const sheet = part(sheetPath)
  if (!sheet) throw new XlsxReadError('not_xlsx')
  const sharedXml = part('xl/sharedStrings.xml')
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => textOf(m[1] ?? '')) : []

  const rows: { row: number; cells: string[] }[] = []
  let implicitRow = 0
  for (const r of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    implicitRow += 1
    const rowNumber = Number(attr(r[1], 'r')) || implicitRow
    implicitRow = rowNumber
    const cells: string[] = []
    let implicitCol = -1
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], 'r')
      const col = ref ? columnIndex(ref) : implicitCol + 1
      implicitCol = col
      if (col < 0 || col >= limits.maxCols) continue
      const type = attr(c[1], 't')
      const inner = c[2] ?? ''
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '')
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
      else value = v !== undefined ? decode(v) : ''
      cells[col] = stripControl(value).trim()
    }
    for (let i = 0; i < cells.length; i++) cells[i] ??= ''
    if (cells.some((x) => x !== '')) {
      rows.push({ row: rowNumber, cells })
      if (rows.length > limits.maxRows) throw new XlsxReadError('too_many_rows')
    }
  }
  return rows
}
