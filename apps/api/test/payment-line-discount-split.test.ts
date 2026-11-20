import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { discountSplit, finalPriceMinor } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * Security check 20.11 (note «2026-11-20 Проверка безопасности ILMORA»), finding №12: the discount split of #121.
 * packages/shared/src/pricing.ts splits the percent a center enters in two — half off for the student, half ILMORA's
 * commission — and the center receives the list price less the whole percent. At checkout the API stores per course
 * (PaymentLine) only the list price and what is paid. The percent is not kept: the course's discount can be changed or
 * removed the next day, and reading it back from the two amounts means reversing a floored formula (the student's part
 * is floored to whole so'm, so on a low price neighbouring percents give the same amount) — so the commission and the
 * center's payout of a past payment are not recorded anywhere.
 *
 * Rule: PaymentLine keeps, at checkout, the percent the center entered (`discountPercent`) or the split itself (the
 * commission and the center's share, `commissionMinor` and `centerShareMinor`), and a checkout with an active discount
 * writes them — matching discountSplit() for that price and percent.
 *
 * KNOWN_GAP pins today's state (neither is stored). When the field lands, the check fails with «remove 'n12-…' from
 * KNOWN_GAP» — then remove the key and the rule is demanded from then on.
 */
const KNOWN_GAP = new Set(['n12-schema', 'n12-checkout'])
function rule(key: string, holds: boolean, what: string) {
  if (KNOWN_GAP.has(key)) expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
  else expect(holds, what).toBe(true)
}

const PERCENT_FIELDS = ['discountPercent']
const SPLIT_FIELDS = ['commissionMinor', 'centerShareMinor']

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8')
const modelFields = (name: string): string[] => {
  const body = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema)?.[1]
  if (!body) return []
  return body.split('\n').map((line) => /^\s*([A-Za-z_]\w*)\s+\S/.exec(line.replace(/\/\/.*$/, ''))?.[1]).filter((f): f is string => !!f)
}

describe('№12 PaymentLine keeps the discount split (schema)', () => {
  it('the model has the percent or the commission and the center\'s share', () => {
    const fields = modelFields('PaymentLine')
    // Setup sanity: the model is found and still has the two amounts it has today.
    expect(fields).toEqual(expect.arrayContaining(['paymentId', 'courseId', 'listPriceMinor', 'amountMinor']))
    const keeps = PERCENT_FIELDS.every((f) => fields.includes(f)) || SPLIT_FIELDS.every((f) => fields.includes(f))
    rule('n12-schema', keeps, `PaymentLine has ${PERCENT_FIELDS.join('')} or ${SPLIT_FIELDS.join(' + ')} (now: ${fields.join(', ')})`)
  })
})

describe.skipIf(!DB_AVAILABLE)('№12 checkout with an active discount writes the split on the line', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('the line of the discounted course records the percent or the commission and center share', async () => {
    const percent = 15
    const startsAt = new Date(Date.now() - 86_400_000)
    const endsAt = new Date(Date.now() + 86_400_000)
    const t = await ctx.makeTenant('split')
    const student = await ctx.makeStudent(t.tenantId)
    await TenantContext.system(() => ctx.prisma.client.course.update({ where: { id: t.course.id }, data: { discountPercent: percent, discountStartsAt: startsAt, discountEndsAt: endsAt } }))
    const { payment } = await TenantContext.forTenant(t.tenantId, async () => {
      await ctx.subscriptions.saveDraft(t.tenantId, student.id, { packageId: null, groupIds: [t.group.id], meyosGrant: false })
      return ctx.subscriptions.checkout(t.tenantId, student.id, 'PAYME')
    })
    const lines = await TenantContext.system(() => ctx.prisma.client.paymentLine.findMany({ where: { paymentId: payment.id } }))

    // Setup sanity: one line for the course, charged list price minus the student's half.
    expect(lines).toHaveLength(1)
    const line = lines[0] as unknown as Record<string, unknown>
    expect(line.courseId).toBe(t.course.id)
    expect(line.listPriceMinor).toBe(t.course.priceMinor)
    expect(line.amountMinor).toBe(finalPriceMinor(t.course.priceMinor, { percent, startsAt, endsAt }))

    const split = discountSplit(Number(t.course.priceMinor / 100n), percent)
    const minor = (v: unknown) => (typeof v === 'bigint' ? v : typeof v === 'number' || typeof v === 'string' ? BigInt(v) : null)
    const keepsPercent = line.discountPercent === percent
    const keepsSplit = minor(line.commissionMinor) === BigInt(split.commission) * 100n && minor(line.centerShareMinor) === BigInt(split.centerReceives) * 100n
    rule('n12-checkout', keepsPercent || keepsSplit, `the PaymentLine of a ${percent}% discount keeps the percent or commission ${split.commission} / center ${split.centerReceives} so'm (now its fields: ${Object.keys(line).join(', ')})`)
  })
})
