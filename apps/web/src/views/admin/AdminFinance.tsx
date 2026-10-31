'use client'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, EmptyState, Eyebrow, Icon, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDate, formatTime } from '../../lib/format'
import { useStore } from '../../store/useStore'

interface ReconRow {
  transactionId: string; seq: number; provider: string; providerTransactionId: string; providerState: number | null; transactionState: string; paymentId: string; paymentState: string
  amountMinor: string; paymentAmountMinor: string; currency: string; createdAt: string; performedAt: string | null; cancelledAt: string | null
  ledger: { settled: boolean; refunded: boolean; journalIds: string[] }; discrepancy: string | null; sandbox: boolean
}
interface Balance { account: string; accountType: string; debit: string; credit: string; net: string }

/** Exact amount with tiyin (never rounded: this is reconciliation), followed by the currency name in the current language. */
const som = (minor: string, unit: string) => `${(Number(minor) / 100).toLocaleString('ru-RU')} ${unit}`

/** Finance admin: provider transactions vs. internal payment state vs. ledger postings, plus independent provider checks. */
export function AdminFinance() {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const roles = useStore((s) => s.auth.user?.roles ?? [])
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<ReconRow[]>([])
  const [total, setTotal] = useState(0)
  const [balances, setBalances] = useState<Balance[]>([])
  const [verify, setVerify] = useState<Record<string, unknown>>({})
  // The failed request is kept, not its text, so the message follows a language switch.
  const [error, setError] = useState<unknown>(null)
  const canSee = roles.includes('FINANCE_ADMIN') || roles.includes('PLATFORM_ADMIN')

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ pageSize: '100', ...(provider ? { provider } : {}), ...(status ? { status } : {}) })
      const [r, b] = await Promise.all([api<{ items: ReconRow[]; total: number }>(`/admin/finance/reconciliation?${q}`), api<Balance[]>('/admin/finance/balances')])
      setRows(r.items); setTotal(r.total); setBalances(b); setError(null)
    } catch (err) {
      setError(err)
    }
  }, [provider, status])

  useEffect(() => { if (canSee) void load() }, [canSee, load])

  const check = async (row: ReconRow) => {
    try {
      const r = await api<Record<string, unknown>>(`/admin/finance/transactions/${row.transactionId}/verify`, { method: 'POST', body: {} })
      setVerify((v) => ({ ...v, [row.transactionId]: r }))
    } catch (err) { notify(apiErrorText(err, lang), 'warn') }
  }
  const settle = async (row: ReconRow) => {
    const reference = prompt(t('finance.manualReference'))
    if (!reference || reference.length < 3) return
    try {
      await api(`/admin/finance/payments/${row.paymentId}/manual-settle`, { method: 'POST', body: { reference } })
      notify(t('common.saved')); void load()
    } catch (err) { notify(apiErrorText(err, lang), 'warn') }
  }

  if (!canSee) return <Notice tone="warn">{t('auth.noAccessBody')}</Notice>

  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('finance.title')} subtitle={t('finance.subtitle')} action={<Button size="sm" variant="secondary" onClick={() => void load()}><Icon name="refresh" className="h-3.5 w-3.5" />{t('common.refresh')}</Button>} />
      {error != null && <Notice tone="warn" className="mb-4">{apiErrorText(error, lang)}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {balances.map((b) => (
          <Card key={b.account} className="p-4"><div className="text-[11px] uppercase tracking-wider text-charcoal/50">{b.account}</div><div className="mt-1 font-display text-2xl text-charcoal">{som(b.net, t('common.som'))}</div><div className="text-[11px] text-charcoal/45">D {som(b.debit, t('common.som'))} · C {som(b.credit, t('common.som'))}</div></Card>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <Eyebrow>{t('finance.transactions')} · {total}</Eyebrow>
        <div className="ml-auto flex gap-2">
          <Select aria-label={t('finance.provider')} className="py-2" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">{t('common.all')}</option><option value="PAYME">Payme</option><option value="CLICK">Click</option><option value="MANUAL">{t('finance.manual')}</option></Select>
          <Select aria-label={t('finance.status')} className="py-2" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('common.all')}</option><option value="CREATED">CREATED</option><option value="PERFORMED">PERFORMED</option><option value="CANCELLED">CANCELLED</option><option value="FAILED">FAILED</option></Select>
        </div>
      </div>
      <Notice tone="info" className="mt-3 text-xs">{t('finance.note')}</Notice>
      {rows.length === 0 ? <div className="mt-4"><EmptyState title={t('finance.empty')} /></div> : (
        <div className="card mt-4 overflow-x-auto p-0">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-ivory/70 text-left text-[11px] uppercase tracking-wider text-charcoal/50">
              <tr><th className="px-4 py-3">{t('finance.provider')}</th><th className="px-3 py-3">{t('finance.providerId')}</th><th className="px-3 py-3">{t('finance.internalId')}</th><th className="px-3 py-3">{t('finance.providerState')}</th><th className="px-3 py-3">{t('finance.paymentState')}</th><th className="px-3 py-3">{t('finance.ledger')}</th><th className="px-3 py-3 text-right">{t('finance.amount')}</th><th className="px-3 py-3">{t('finance.time')}</th><th className="px-3 py-3">{t('finance.discrepancy')}</th><th className="px-3 py-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-charcoal/8">
              {rows.map((r) => (
                <tr key={r.transactionId} className="align-top hover:bg-ivory/40">
                  <td className="px-4 py-2.5 font-medium text-charcoal">{r.provider}{r.sandbox && <Badge tone="muted" className="ml-1">{t('finance.sandbox')}</Badge>}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-charcoal/70">{r.providerTransactionId}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-charcoal/70">#{r.seq}<br /><span className="text-charcoal/45">{r.paymentId}</span></td>
                  <td className="px-3 py-2.5 text-charcoal/70">{r.transactionState}{r.providerState !== null && <span className="text-charcoal/45"> ({r.providerState})</span>}</td>
                  <td className="px-3 py-2.5"><Badge tone={r.paymentState === 'PAID' ? 'sage' : r.paymentState === 'PENDING' ? 'neutral' : 'warn'}>{r.paymentState}</Badge></td>
                  <td className="px-3 py-2.5 text-xs text-charcoal/70">{r.ledger.settled ? t('finance.posted') : '—'}{r.ledger.refunded && ` · ${t('finance.reversed')}`}</td>
                  <td className="px-3 py-2.5 text-right text-charcoal">{som(r.amountMinor, t('common.som'))}{r.amountMinor !== r.paymentAmountMinor && <div className="text-[11px] text-red-700">≠ {som(r.paymentAmountMinor, t('common.som'))}</div>}</td>
                  <td className="px-3 py-2.5 text-xs text-charcoal/60">{formatDate(r.createdAt, lang)} {formatTime(r.createdAt, lang)}{r.performedAt && <div>✓ {formatTime(r.performedAt, lang)}</div>}</td>
                  <td className="px-3 py-2.5">{r.discrepancy ? <Badge tone="danger">{r.discrepancy}</Badge> : <Badge tone="sage">{t('finance.match')}</Badge>}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      <Button size="sm" variant="ghost" onClick={() => void check(r)}>{t('finance.verify')}</Button>
                      {r.paymentState === 'PENDING' && <Button size="sm" variant="ghost" onClick={() => void settle(r)}>{t('finance.manualSettle')}</Button>}
                    </div>
                    {verify[r.transactionId] !== undefined && <pre className="mt-1 max-w-[16rem] overflow-x-auto rounded bg-ivory p-2 text-[10px] text-charcoal/70">{JSON.stringify(verify[r.transactionId], null, 1)}</pre>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
