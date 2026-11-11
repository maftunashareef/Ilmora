import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { humanDay, localDay } from '../src/common/time'
import { OutboxProcessor } from '../src/modules/payments/outbox.processor'

const SRC = join(__dirname, '..', 'src')
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  if (statSync(p).isDirectory()) return n === 'generated' ? [] : files(p)
  return p.endsWith('.ts') ? [p] : []
})

/**
 * Н7 / review 11.11 №100: the day of an instant was taken on UTC (`toISOString().slice(0, 10)`) — a payment at 02:00 on
 * 1 December in Tashkent showed «30.11» in the SMS receipt. The second bug of the kind; so the pattern lives only in
 * common/time.ts, and everything else asks it for a Tashkent day (localDay, todayLocal, humanDay) or a DATE column
 * (dateColumnToIso).
 */
describe('Days are taken on the Tashkent calendar (Н7)', () => {
  it('no module takes the day of an instant on UTC', () => {
    const offenders = files(SRC)
      .filter((f) => !f.endsWith(join('common', 'time.ts')))
      .flatMap((f) => readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
      .filter(({ line }) => /toISOString\(\)\s*\.\s*(slice|substring|substr)\(\s*0\s*,\s*10\s*\)|toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)/.test(line))
      .map(({ f, i }) => `${relative(SRC, f)}:${i + 1}`)
    expect(offenders, 'use localDay / todayLocal / humanDay, or dateColumnToIso for DATE columns (common/time.ts)').toEqual([])
  })

  it('02:00 on 1 December in Tashkent is the 1st, not the 30th', () => {
    const at = new Date('2026-11-30T21:00:00.000Z')
    expect(localDay(at)).toBe('2026-12-01')
    expect(humanDay(at)).toBe('01.12.2026')
  })

  it('the SMS receipt names the period in Tashkent days', async () => {
    const sms = { enqueue: vi.fn(async () => 'sms-1') }
    const payment = { id: 'p1', amountMinor: 50_000_00n, periodStart: new Date('2026-11-30T21:00:00.000Z'), periodEnd: new Date('2026-12-31T21:00:00.000Z'), student: { phoneE164: '+998901112233', preferredLang: 'ru' }, receipt: { id: 'r1', number: 'R-2026-000001' } }
    const prisma = { client: { payment: { findFirst: async () => payment }, receipt: { updateMany: async () => ({ count: 1 }), update: async () => ({}) } } }
    const processor = Object.assign(Object.create(OutboxProcessor.prototype), { prisma, sms }) as { receipt(t: string, id: string): Promise<void> }
    await processor.receipt('t', 'p1')
    expect(sms.enqueue).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'sms.receipt', vars: expect.objectContaining({ period: '01.12.2026 – 01.01.2027' }) }))
  })
})
