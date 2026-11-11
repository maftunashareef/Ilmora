import { inflateRawSync } from 'node:zlib'

/** The files of an .xlsx (a zip of deflated entries) as text, by name — for reading what an export wrote. */
export function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  let p = 0
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18)
    const nameLen = buf.readUInt16LE(p + 26)
    const extra = buf.readUInt16LE(p + 28)
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString('utf8')
    const data = buf.subarray(p + 30 + nameLen + extra, p + 30 + nameLen + extra + size)
    out.set(name, inflateRawSync(data).toString('utf8'))
    p += 30 + nameLen + extra + size
  }
  return out
}
