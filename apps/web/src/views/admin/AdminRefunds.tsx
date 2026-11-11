'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { formatDate, type L } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Field, Icon, Input, Modal, Notice, Select, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import {
  approveProblem, formatMinor, leftOf, noteOk, parseSom, providerRefOk, reasonTextProblem, REASON_TEXT_MAX, REFUND_REASONS, REFUND_STATUSES, refundQueue,
  type AdminRefundDto, type RefundQueueFilter, type RefundReason, type RefundStatus,
} from '../../services/refunds'
import { useStore } from '../../store/useStore'

const STATUS_TONE: Record<RefundStatus, 'champagne' | 'forest' | 'danger' | 'sage' | 'muted'> = { PENDING: 'champagne', APPROVED: 'forest', REJECTED: 'danger', PAID: 'sage', WITHDRAWN: 'muted' }
const isL = (v: unknown): v is L => !!v && typeof v === 'object' && 'ru' in (v as object)
type Action = { kind: 'approve' | 'reject' | 'paid'; item: AdminRefundDto }

/**
 * «Финансы» → «Возвраты» (offer 6.6, security review 10.11 №42): the queue by due date; approve with the amount, decline
 * with a reason the student sees, mark the money sent. `focus` — the request a notification opened (`?request=`).
 */
export function AdminRefunds({ focus }: { focus: string | null }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const roles = useStore((s) => s.auth.user?.roles ?? [])
  // A notification opens one request, whatever its status; otherwise the queue starts with those waiting for a decision.
  const [filter, setFilter] = useState<RefundQueueFilter>({ status: focus ? '' : 'PENDING', overdue: false, page: 1 })
  const [data, setData] = useState<Awaited<ReturnType<typeof refundQueue.list>> | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [round, setRound] = useState(0)
  const [action, setAction] = useState<Action | null>(null)
  const [letterOpen, setLetterOpen] = useState(false)
  const scrolled = useRef(false)

  useEffect(() => {
    let live = true
    refundQueue.list(filter).then((d) => { if (live) { setData(d); setError(null) } }, (e) => { if (live) setError(e) })
    return () => { live = false }
  }, [filter, round])

  useEffect(() => {
    if (!focus || !data || scrolled.current) return
    const el = document.getElementById(`refund-${focus}`)
    if (el) { scrolled.current = true; el.scrollIntoView({ block: 'center' }) }
  }, [focus, data])

  const done = useCallback((text: string) => { setAction(null); notify(text); setRound((r) => r + 1) }, [notify])
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div>
      <Notice tone="info" className="mb-4 text-xs">{t('refund.queueHint')}</Notice>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-60"><Select aria-label={t('finance.status')} className="py-2" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as RefundStatus | '', page: 1 })}>
          <option value="">{t('refund.filter.all')}</option>
          {REFUND_STATUSES.map((s) => <option key={s} value={s}>{t(`refund.status.${s}`)}</option>)}
        </Select></div>
        <label className="flex cursor-pointer items-center gap-2 rounded-control border border-charcoal/12 bg-paper px-3 py-2 text-sm text-charcoal/80">
          <input type="checkbox" className="h-4 w-4 accent-forest" checked={filter.overdue} onChange={(e) => setFilter({ ...filter, overdue: e.target.checked, page: 1 })} />
          {t('refund.filter.overdue')}
        </label>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setLetterOpen(true)}><Icon name="plus" className="h-3.5 w-3.5" />{t('refund.fromLetter')}</Button>
      </div>
      {error != null && <Notice tone="warn" className="mb-3">{apiErrorText(error, lang)}</Notice>}
      {!data && error == null && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {data && data.items.length === 0 && <EmptyState icon={<Icon name="check" className="h-6 w-6" />} title={t('refund.empty')} />}
      {data && data.items.length > 0 && (
        <ul className="space-y-3" aria-label={t('refund.tab.refunds')}>
          {data.items.map((r) => <li key={r.id}><RefundCard item={r} focused={r.id === focus} onAction={(kind) => setAction({ kind, item: r })} /></li>)}
        </ul>
      )}
      {data && pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-xs text-charcoal/55">
          <span>{t('rev.page', { page: data.page, pages })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={data.page <= 1} onClick={() => setFilter({ ...filter, page: filter.page - 1 })}>{t('common.back')}</Button>
            <Button size="sm" variant="ghost" disabled={data.page >= pages} onClick={() => setFilter({ ...filter, page: filter.page + 1 })}>{t('common.next')}</Button>
          </div>
        </div>
      )}
      {action?.kind === 'approve' && <ApproveDialog item={action.item} onClose={() => setAction(null)} onDone={(amount) => done(t('refund.approvedToast', { amount: formatMinor(amount) }))} />}
      {action?.kind === 'reject' && <RejectDialog item={action.item} onClose={() => setAction(null)} onDone={() => done(t('refund.rejectedToast'))} />}
      {action?.kind === 'paid' && <PaidDialog item={action.item} onClose={() => setAction(null)} onDone={() => done(t('refund.paidToast'))} />}
      {letterOpen && <FromLetterDialog canSearch={roles.includes('PLATFORM_ADMIN')} onClose={() => setLetterOpen(false)} onDone={() => { setLetterOpen(false); notify(t('refund.filed')); setRound((r) => r + 1) }} />}
    </div>
  )
}

function Money({ label, minor, strong }: { label: ReactNode; minor: string | null; strong?: boolean }) {
  const { t } = useT()
  return (
    <div>
      <dt className="text-[11px] text-charcoal/50">{label}</dt>
      <dd className={strong ? 'font-display text-xl text-charcoal' : 'text-sm tabular-nums text-charcoal'}>{formatMinor(minor)} <span className="text-xs text-charcoal/55">{t('common.som')}</span></dd>
    </div>
  )
}

function RefundCard({ item: r, focused, onAction }: { item: AdminRefundDto; focused: boolean; onAction: (kind: Action['kind']) => void }) {
  const { t, tr, lang } = useT()
  const courses = useStore((s) => s.courses)
  const title = (l: AdminRefundDto['lines'][number]) => (isL(l.courseTitle) ? tr(l.courseTitle) : typeof l.courseTitle === 'string' && l.courseTitle ? l.courseTitle : courses.find((c) => c.id === l.courseId) ? tr(courses.find((c) => c.id === l.courseId)!.title) : l.courseId)
  return (
    <Card className={focused ? 'ring-2 ring-champagne ring-offset-2' : undefined}>
      <div id={`refund-${r.id}`} className="scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-charcoal">{r.student.displayName}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={STATUS_TONE[r.status]}>{t(`refund.status.${r.status}`)}</Badge>
              {r.overdue && <Badge tone="danger"><Icon name="clock" className="h-3 w-3" />{t('refund.overdue')}</Badge>}
              {r.source === 'EMAIL' && <Badge tone="muted">{t('refund.source.EMAIL')}</Badge>}
              {r.toOtherAccount && <Badge tone="warn">{t('refund.toOtherAccountBadge')}</Badge>}
            </div>
            <p className="mt-1.5 text-xs text-charcoal/60">
              {t('refund.created', { date: formatDate(r.createdAt, lang) })} · {t(`refund.reason.${r.reason}`)}
              {(r.status === 'PENDING' || r.status === 'APPROVED') && <> · {t('refund.dueBy', { date: formatDate(r.decisionDueAt, lang) })}</>}
            </p>
            {r.reasonText && <p className="mt-1 text-sm text-charcoal/75">«{r.reasonText}»</p>}
          </div>
          <dl className="text-right"><Money label={r.approvedMinor ? t('refund.approvedSum') : t('refund.requested')} minor={r.approvedMinor ?? r.requestedMinor} strong /></dl>
        </div>

        {r.lines.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead><tr className="text-left text-xs text-charcoal/55">
                <th scope="col" className="pb-1.5 font-medium">{t('refund.course')}</th>
                <th scope="col" className="pb-1.5 text-right font-medium">{t('refund.price')}</th>
                <th scope="col" className="pb-1.5 text-right font-medium">{t('refund.lessonsHeld')}</th>
                <th scope="col" className="pb-1.5 text-right font-medium">{t('refund.amount')}</th>
              </tr></thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.enrollmentId} className="border-t border-charcoal/8">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-charcoal">{title(l)}</th>
                    <td className="py-1.5 text-right tabular-nums text-charcoal/70">{formatMinor(l.priceMinor)}</td>
                    <td className="py-1.5 text-right tabular-nums text-charcoal/70">{t('refund.lessonsOf', { held: l.lessonsHeld, total: l.lessonsTotal })}</td>
                    <td className="py-1.5 text-right tabular-nums text-charcoal">{formatMinor(l.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-3 rounded-control bg-ivory/70 px-3 py-2.5 sm:grid-cols-4">
          <Money label={`${t('refund.payment')}: ${t('refund.paidSum').toLowerCase()}`} minor={r.payment.amountMinor} />
          <Money label={t('refund.refundedSum')} minor={r.payment.refundedMinor} />
          <Money label={t('refund.left')} minor={leftOf(r.payment)} />
          <div>
            <dt className="text-[11px] text-charcoal/50">{t('refund.period')}</dt>
            <dd className="text-sm text-charcoal">{formatDate(r.payment.periodStart, lang)} — {formatDate(r.payment.periodEnd, lang)}<span className="block text-xs text-charcoal/55">{r.payment.provider ?? '—'}</span></dd>
          </div>
        </dl>

        {(r.decidedAt || r.decisionNote || r.providerRef) && (
          <p className="mt-3 text-xs text-charcoal/65">
            {r.decidedAt && t('refund.decidedOn', { date: formatDate(r.decidedAt, lang) })}
            {r.decisionNote && <> · «{r.decisionNote}»</>}
            {r.providerRef && <> · {t('refund.reference', { ref: r.providerRef })}</>}
            {r.paidAt && <> · {t('refund.paidOn', { date: formatDate(r.paidAt, lang) })}</>}
          </p>
        )}

        {(r.status === 'PENDING' || r.status === 'APPROVED') && (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" className="text-red-800" onClick={() => onAction('reject')}>{t('refund.reject')}</Button>
            {r.status === 'PENDING' && <Button size="sm" onClick={() => onAction('approve')}><Icon name="check" className="h-3.5 w-3.5" />{t('refund.approve')}</Button>}
            {r.status === 'APPROVED' && <Button size="sm" onClick={() => onAction('paid')}><Icon name="check" className="h-3.5 w-3.5" />{t('refund.markPaid')}</Button>}
          </div>
        )}
      </div>
    </Card>
  )
}

/** Runs one decision; the error (409 when someone else decided meanwhile) stays in the dialog. */
function useSubmit(run: () => Promise<unknown>, onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const submit = async () => {
    setBusy(true); setError(null)
    try { await run(); onDone() } catch (e) { setError(e); setBusy(false) }
  }
  return { busy, error, submit }
}

function ApproveDialog({ item, onClose, onDone }: { item: AdminRefundDto; onClose: () => void; onDone: (amount: string) => void }) {
  const { t, lang } = useT()
  const [amount, setAmount] = useState(item.requestedMinor === '0' ? '' : formatMinor(item.requestedMinor))
  const [note, setNote] = useState('')
  const minor = parseSom(amount)
  const problem = approveProblem(minor, item.payment)
  const { busy, error, submit } = useSubmit(() => refundQueue.approve(item.id, minor!, note), () => onDone(minor!))
  const left = formatMinor(leftOf(item.payment))
  return (
    <Modal open onClose={onClose} title={t('refund.approveTitle')} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button disabled={busy || problem !== null} onClick={() => void submit()}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('refund.approve')}</Button>
    </>}>
      <p className="text-sm text-charcoal/70">{item.student.displayName} · {t(`refund.reason.${item.reason}`)}</p>
      <div className="mt-4 grid gap-4">
        <Field label={t('refund.amountLabel')} hint={t('refund.amountHint', { counted: formatMinor(item.requestedMinor), left })} required>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== '' && problem !== null} className="font-display text-xl tabular-nums" />
          {amount !== '' && problem && <p className="mt-1.5 text-xs text-red-700" role="alert">{problem === 'invalid' ? t('refund.amountInvalid') : problem === 'zero' ? t('refund.amountZero') : t('refund.amountTooMuch', { left })}</p>}
        </Field>
        <Field label={t('refund.noteOptional')}>
          <Textarea value={note} maxLength={1000} placeholder={t('refund.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {error != null && <Notice tone="warn" className="mt-4">{apiErrorText(error, lang)}</Notice>}
    </Modal>
  )
}

function RejectDialog({ item, onClose, onDone }: { item: AdminRefundDto; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useT()
  const [note, setNote] = useState('')
  const { busy, error, submit } = useSubmit(() => refundQueue.reject(item.id, note), onDone)
  return (
    <Modal open onClose={onClose} title={t('refund.rejectTitle')} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="danger" disabled={busy || !noteOk(note)} onClick={() => void submit()}>{t('refund.reject')}</Button>
    </>}>
      <p className="text-sm text-charcoal/70">{item.student.displayName} · {formatMinor(item.requestedMinor)} {t('common.som')}</p>
      <Field label={t('refund.rejectNote')} hint={t('refund.noteShort')} required className="mt-4">
        <Textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error != null && <Notice tone="warn" className="mt-4">{apiErrorText(error, lang)}</Notice>}
    </Modal>
  )
}

function PaidDialog({ item, onClose, onDone }: { item: AdminRefundDto; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useT()
  const [ref, setRef] = useState('')
  const { busy, error, submit } = useSubmit(() => refundQueue.paid(item.id, ref), onDone)
  return (
    <Modal open onClose={onClose} title={t('refund.markPaid')} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button disabled={busy || !providerRefOk(ref)} onClick={() => void submit()}><Icon name="check" className="h-4 w-4" />{t('refund.markPaid')}</Button>
    </>}>
      <p className="text-sm text-charcoal/70">{item.student.displayName} · {formatMinor(item.approvedMinor)} {t('common.som')}</p>
      <Field label={t('refund.providerRef')} hint={t('refund.noteShort')} required className="mt-4">
        <Input value={ref} maxLength={200} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <p className="mt-3 text-xs text-charcoal/60">{t('refund.paidHint')}</p>
      {error != null && <Notice tone="warn" className="mt-4">{apiErrorText(error, lang)}</Notice>}
    </Modal>
  )
}

type StudentHit = { id: string; displayName: string; login: string | null; phoneMasked: string | null }

/** A request from a letter (appendix 2): the student, the reason — the whole subscription, counted as from the cabinet. */
function FromLetterDialog({ canSearch, onClose, onDone }: { canSearch: boolean; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useT()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<StudentHit[] | null>(null)
  const [student, setStudent] = useState<StudentHit | null>(null)
  const [reason, setReason] = useState<RefundReason>('REFUSAL')
  const [text, setText] = useState('')
  const [other, setOther] = useState(false)
  const form = { enrollmentIds: [], allCourses: true, reason, reasonText: text, toOtherAccount: other }
  const problem = reasonTextProblem(form)
  const { busy, error, submit } = useSubmit(() => refundQueue.fromLetter(student!.id, form), onDone)
  const search = async () => {
    if (q.trim().length < 2) return
    try { setHits((await api<{ items: StudentHit[] }>(`/admin/users?role=STUDENT&pageSize=10&search=${encodeURIComponent(q.trim())}`)).items) } catch { setHits([]) }
  }
  return (
    <Modal open onClose={onClose} title={t('refund.fromLetter')} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button disabled={busy || !student || problem !== null} onClick={() => void submit()}>{t('refund.submit')}</Button>
    </>}>
      <p className="text-sm text-charcoal/70">{t('refund.fromLetterHint')}</p>
      {!canSearch ? <Notice tone="warn" className="mt-4">{t('refund.fromLetterNoSearch')}</Notice> : (
        <div className="mt-4 grid gap-4">
          <Field label={t('refund.student')} required>
            {student ? (
              <div className="flex items-center justify-between gap-2 rounded-control border border-forest/40 bg-sage/30 px-3 py-2 text-sm">
                <span>{student.displayName}{student.login && <span className="text-charcoal/55"> · @{student.login}</span>}{student.phoneMasked && <span className="text-charcoal/55"> · {student.phoneMasked}</span>}</span>
                <Button size="sm" variant="ghost" onClick={() => setStudent(null)}><Icon name="x" className="h-3.5 w-3.5" /></Button>
              </div>
            ) : (
              <>
                <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search() }}>
                  <Input aria-label={t('refund.studentSearch')} placeholder={t('refund.studentSearch')} value={q} onChange={(e) => setQ(e.target.value)} />
                  <Button type="submit" variant="secondary"><Icon name="search" className="h-4 w-4" /></Button>
                </form>
                {hits && (hits.length === 0 ? <p className="mt-2 text-xs text-charcoal/55">{t('rev.nothingFound')}</p> : (
                  <ul className="mt-2 space-y-1">
                    {hits.map((h) => (
                      <li key={h.id}><button type="button" onClick={() => setStudent(h)} className="w-full rounded-control border border-charcoal/10 px-3 py-2 text-left text-sm hover:border-forest/40">
                        {h.displayName}{h.login && <span className="text-charcoal/55"> · @{h.login}</span>}{h.phoneMasked && <span className="text-charcoal/55"> · {h.phoneMasked}</span>}
                      </button></li>
                    ))}
                  </ul>
                ))}
              </>
            )}
          </Field>
          <Field label={t('refund.reason')} required>
            <Select value={reason} onChange={(e) => setReason(e.target.value as RefundReason)}>
              {REFUND_REASONS.map((r) => <option key={r} value={r}>{t(`refund.reason.${r}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('refund.reasonText')} required={reason === 'OTHER'}>
            <Textarea value={text} maxLength={REASON_TEXT_MAX + 50} onChange={(e) => setText(e.target.value)} />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-charcoal/80">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-forest" checked={other} onChange={(e) => setOther(e.target.checked)} />
            <span>{t('refund.otherAccount')}</span>
          </label>
        </div>
      )}
      {error != null && <Notice tone="warn" className="mt-4">{apiErrorText(error, lang)}</Notice>}
    </Modal>
  )
}
