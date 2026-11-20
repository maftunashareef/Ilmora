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
 * center's payout of a past payment are not recorded anywhere. The ledger does not hold it either: on settlement
 * LedgerService.settlementEntries posts the whole amount clearing -> SUBSCRIPTION_REVENUE, nothing to CENTER_PAYABLE.
 *
 * Rule: PaymentLine keeps, at checkout, the percent the center entered (`discountPercent`) or the commission
 * (`commissionMinor`; the center's share is then the amount paid less it, `centerShareMinor` is optional), and a
 * checkout with an active discount writes it — matching discountSplit() for that price and percent. Another valid fix
 * is the double-entry ledger: settlementEntries splitting the payment into ILMORA's commission and CENTER_PAYABLE (a new
 * account type or entries per line); this test then needs its check pointed at the ledger instead.
 *
 * KNOWN_GAP pins today's exact shape: the PaymentLine fields in schema.prisma, the keys of a written line and the
 * LedgerAccountType values. Any change to them fails as «re-evaluate n12» even before the rule holds, so a fix that lands
 * in a place this test does not look at is not missed. When the rule holds, the check fails with «remove 'n12-…' from
 * KNOWN_GAP» — then remove the key and the rule is demanded from then on.
 */
const KNOWN_GAP = new Set(['n12-schema', 'n12-checkout'])
const checked = new Set<string>()
function rule(key: string, holds: boolean, what: string, todayObserved: boolean) {
  checked.add(key)
  if (KNOWN_GAP.has(key)) {
    expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
    expect(todayObserved, `${what} — PaymentLine or the ledger changed: re-evaluate '${key}' (the fix may be elsewhere)`).toBe(true)
  } else expect(holds, what).toBe(true)
}
const expectChecked = (...keys: string[]) => {
  for (const key of keys) if (KNOWN_GAP.has(key)) expect(checked.has(key), `'${key}' in KNOWN_GAP was never checked`).toBe(true)
}

/** Today's shape (the gap): model fields incl. relations, the scalar keys of a row, the ledger's account types. */
const TODAY_MODEL_FIELDS = ['id', 'tenantId', 'tenant', 'paymentId', 'payment', 'enrollmentId', 'enrollment', 'courseId', 'course', 'listPriceMinor', 'amountMinor']
const TODAY_ROW_KEYS = ['id', 'tenantId', 'paymentId', 'enrollmentId', 'courseId', 'listPriceMinor', 'amountMinor']
const TODAY_LEDGER_TYPES = ['PROVIDER_CLEARING', 'SUBSCRIPTION_REVENUE', 'CENTER_PAYABLE', 'STUDENT_CREDIT', 'REFUNDS', 'ADJUSTMENTS']

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8')
const blockLines = (kind: 'model' | 'enum', name: string): string[] => {
  const body = new RegExp(`^${kind} ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema)?.[1]
  if (!body) return []
  return body.split('\n').map((line) => /^\s*([A-Za-z_]\w*)\b/.exec(line.replace(/\/\/.*$/, ''))?.[1]).filter((f): f is string => !!f)
}
const sameList = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

describe('№12 PaymentLine keeps the discount split (schema)', () => {
  afterAll(() => expectChecked('n12-schema'))

  it('the model has the percent or the commission', () => {
    const fields = blockLines('model', 'PaymentLine')
    const ledgerTypes = blockLines('enum', 'LedgerAccountType')
    // Setup sanity: the model and the enum are found and PaymentLine still has the two amounts it has today.
    expect(fields).toEqual(expect.arrayContaining(['paymentId', 'courseId', 'listPriceMinor', 'amountMinor']))
    expect(ledgerTypes.length).toBeGreaterThan(0)
    const keeps = fields.includes('discountPercent') || fields.includes('commissionMinor')
    const today = sameList(fields, TODAY_MODEL_FIELDS) && sameList(ledgerTypes, TODAY_LEDGER_TYPES)
    rule('n12-schema', keeps, `PaymentLine has discountPercent or commissionMinor (now: ${fields.join(', ')}; LedgerAccountType: ${ledgerTypes.join(', ')})`, today)
  })
})

describe.skipIf(!DB_AVAILABLE)('№12 checkout with an active discount writes the split on the line', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(async () => {
    await ctx.close()
    expectChecked('n12-checkout')
  })

  it('the line of the discounted course records the percent or the commission', async () => {
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
    const keepsCommission = minor(line.commissionMinor) === BigInt(split.commission) * 100n
      && (!('centerShareMinor' in line) || minor(line.centerShareMinor) === BigInt(split.centerReceives) * 100n)
    rule('n12-checkout', keepsPercent || keepsCommission, `the PaymentLine of a ${percent}% discount keeps the percent or commission ${split.commission} so'm (center ${split.centerReceives}) (now its keys: ${Object.keys(line).join(', ')})`, sameList(Object.keys(line), TODAY_ROW_KEYS))
  })
})
