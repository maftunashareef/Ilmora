import { Injectable } from '@nestjs/common'
import type { JournalKind, LedgerAccountType, LedgerDirection } from '../../generated/prisma/enums'
import type { TransactionClient } from '../../infra/prisma/prisma.service'

export interface EntryInput { account: string; accountType: LedgerAccountType; direction: LedgerDirection; amountMinor: bigint }

/**
 * Append-only double-entry ledger. A journal is balanced (debits = credits) or rejected; settled journals are
 * never edited — corrections are reversal journals that point back at the original.
 */
@Injectable()
export class LedgerService {
  /** Idempotent per (tenant, kind, referenceType, referenceId): a second call returns the existing journal. */
  async post(tx: TransactionClient, input: { tenantId: string; kind: JournalKind; referenceType: string; referenceId: string; description: string; entries: EntryInput[]; createdById?: string; reason?: string }) {
    const debits = input.entries.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + e.amountMinor, 0n)
    const credits = input.entries.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + e.amountMinor, 0n)
    if (debits !== credits) throw new Error(`Unbalanced journal ${input.kind}/${input.referenceId}: debits ${debits} ≠ credits ${credits}`)
    if (input.entries.some((e) => e.amountMinor <= 0n)) throw new Error('Ledger entries must be positive')
    const existing = await tx.ledgerJournal.findUnique({
      where: { tenantId_kind_referenceType_referenceId: { tenantId: input.tenantId, kind: input.kind, referenceType: input.referenceType, referenceId: input.referenceId } },
    })
    if (existing) return existing
    return tx.ledgerJournal.create({
      data: {
        tenantId: input.tenantId,
        kind: input.kind,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        description: input.description,
        createdById: input.createdById,
        reason: input.reason,
        entries: { create: input.entries.map((e) => ({ tenantId: input.tenantId, account: e.account, accountType: e.accountType, direction: e.direction, amountMinor: e.amountMinor })) },
      },
    })
  }

  /** Reverse a journal by posting mirrored entries; the original stays untouched. */
  async reverse(tx: TransactionClient, journalId: string, kind: JournalKind, reason: string, createdById?: string) {
    const original = await tx.ledgerJournal.findFirst({ where: { id: journalId }, include: { entries: true, reversedBy: true } })
    if (!original) throw new Error(`Journal ${journalId} not found`)
    if (original.reversedBy) return original.reversedBy
    return tx.ledgerJournal.create({
      data: {
        tenantId: original.tenantId,
        kind,
        referenceType: original.referenceType,
        referenceId: `${original.referenceId}:reversal:${original.id}`,
        description: `Reversal of ${original.description}`,
        reversalOfId: original.id,
        reason,
        createdById,
        entries: { create: original.entries.map((e) => ({ tenantId: e.tenantId, account: e.account, accountType: e.accountType, direction: e.direction === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const), amountMinor: e.amountMinor })) },
      },
    })
  }

  /** Standard settlement posting: provider clearing (asset) ← debit, subscription revenue ← credit. */
  settlementEntries(provider: string, amountMinor: bigint): EntryInput[] {
    return [
      { account: `clearing:${provider.toLowerCase()}`, accountType: 'PROVIDER_CLEARING', direction: 'DEBIT', amountMinor },
      { account: 'revenue:subscriptions', accountType: 'SUBSCRIPTION_REVENUE', direction: 'CREDIT', amountMinor },
    ]
  }
}
