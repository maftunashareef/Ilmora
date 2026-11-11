'use client'
import { useCallback, useEffect, useState } from 'react'
import { formatDate, type L } from '@ilmora/shared'
import { Badge, Button, Card, Eyebrow, Field, Icon, Modal, Notice, Select, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import {
  ENDS_COURSE, formatMinor, myRefunds, REASON_TEXT_MAX, reasonTextProblem, REFUND_REASONS, type RefundableCourse, type RefundForm, type RefundLineDto,
  type RefundQuoteDto, type RefundReason, type RefundRequestDto, type RefundStatus,
} from '../../services/refunds'
import { useStore } from '../../store/useStore'

const STATUS_TONE: Record<RefundStatus, 'champagne' | 'forest' | 'danger' | 'sage' | 'muted'> = { PENDING: 'champagne', APPROVED: 'forest', REJECTED: 'danger', PAID: 'sage', WITHDRAWN: 'muted' }
const isL = (v: unknown): v is L => !!v && typeof v === 'object' && 'ru' in (v as object)

/** A course's title: the request line's own (stored with the request), else the catalog's. */
function useCourseTitle() {
  const { tr } = useT()
  const courses = useStore((s) => s.courses)
  return useCallback((courseId: string, own?: RefundLineDto['courseTitle']) => {
    if (isL(own)) return tr(own)
    if (typeof own === 'string' && own) return own
    const c = courses.find((x) => x.id === courseId)
    return c ? tr(c.title) : courseId
  }, [courses, tr])
}

const sumMinor = (q: RefundQuoteDto) => q.requests.reduce((n, r) => n + BigInt(r.requestedMinor), 0n).toString()

/**
 * The refund request (offer 6.3–6.6, appendix 2): the courses, the reason, «to another account». What would come back is
 * counted by the API as the form changes (`/refunds/quote`, nothing is written) and shown per course before sending.
 */
export function RefundDialog({ kind, onClose, onFiled }: { kind: 'PERIOD' | 'LESSONS'; onClose: () => void; onFiled: (r: { endsCourses: boolean; requested: string }) => void }) {
  const { t, lang } = useT()
  const title = useCourseTitle()
  const [list, setList] = useState<RefundableCourse[] | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [reason, setReason] = useState<RefundReason>('REFUSAL')
  const [text, setText] = useState('')
  const [other, setOther] = useState(false)
  const [quote, setQuote] = useState<{ for: string; q?: RefundQuoteDto; error?: unknown } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    let live = true
    myRefunds.courses().then((l) => { if (live) { setList(l); setChosen(l.map((c) => c.enrollmentId)) } }, (e) => { if (live) setError(e) })
    return () => { live = false }
  }, [])

  const form: RefundForm = { enrollmentIds: chosen, allCourses: !!list && chosen.length === list.length, reason, reasonText: text, toOtherAccount: other }
  // The count depends on the courses and the reason only.
  const key = `${[...chosen].sort().join(',')}|${reason}`
  useEffect(() => {
    if (!list || chosen.length === 0) return
    let live = true
    const body: RefundForm = { enrollmentIds: chosen, allCourses: chosen.length === list.length, reason, reasonText: '', toOtherAccount: false }
    const timer = setTimeout(() => {
      myRefunds.quote(body).then((q) => { if (live) setQuote({ for: key, q }) }, (e) => { if (live) setQuote({ for: key, error: e }) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [list, chosen, reason, key])

  const current = quote?.for === key ? quote : null
  const textProblem = reasonTextProblem(form)
  const total = current?.q ? sumMinor(current.q) : null
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  const submit = async () => {
    setTouched(true)
    if (textProblem || chosen.length === 0) return
    setBusy(true); setError(null)
    try {
      const r = await myRefunds.file(form)
      onFiled({ endsCourses: r.endsCourses, requested: r.requests.reduce((n, x) => n + BigInt(x.requestedMinor), 0n).toString() })
    } catch (e) {
      setError(e); setBusy(false)
    }
  }

  const reasonHint = reason === 'LESSONS_NOT_HELD' ? t('refund.goesOn') : ENDS_COURSE.has(reason) ? t('refund.endsCourses') : null
  return (
    <Modal open onClose={onClose} title={t('refund.title')} wide footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="danger" disabled={busy || !list || chosen.length === 0} onClick={() => void submit()}>
        {busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('refund.submit')}
      </Button>
    </>}>
      <p className="text-sm leading-relaxed text-charcoal/70">{t('refund.intro')}</p>
      {error != null && <Notice tone="warn" className="mt-4">{apiErrorText(error, lang)}</Notice>}

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium text-charcoal">{t('refund.courses')}</legend>
        {!list && error == null && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
        {list && (
          <ul className="space-y-1.5">
            {list.map((c) => (
              <li key={c.enrollmentId}>
                <label className={`flex items-center gap-3 rounded-control border px-3 py-2.5 text-sm ${chosen.includes(c.enrollmentId) ? 'border-forest/50 bg-sage/30' : 'border-charcoal/12'} ${kind === 'LESSONS' ? 'opacity-80' : 'cursor-pointer'}`}>
                  <input type="checkbox" className="h-4 w-4 accent-forest" checked={chosen.includes(c.enrollmentId)} disabled={kind === 'LESSONS'} onChange={() => toggle(c.enrollmentId)} />
                  <span className="text-charcoal">{title(c.courseId)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {kind === 'LESSONS' && <p className="mt-1.5 text-xs text-charcoal/55">{t('refund.packageWhole')}</p>}
        {touched && list && chosen.length === 0 && <p className="mt-1.5 text-xs text-red-700" role="alert">{t('apiError.refundCourses')}</p>}
      </fieldset>

      <div className="mt-5 grid gap-4">
        <Field label={t('refund.reason')} required>
          <Select value={reason} onChange={(e) => setReason(e.target.value as RefundReason)}>
            {REFUND_REASONS.map((r) => <option key={r} value={r}>{t(`refund.reason.${r}`)}</option>)}
          </Select>
          {reasonHint && <p className="mt-1.5 text-xs text-charcoal/60">{reasonHint}</p>}
        </Field>
        <Field label={t('refund.reasonText')} required={reason === 'OTHER'}>
          <Textarea value={text} maxLength={REASON_TEXT_MAX + 50} onChange={(e) => setText(e.target.value)} aria-invalid={touched && !!textProblem} />
          {touched && textProblem && <p className="mt-1.5 text-xs text-red-700" role="alert">{t(textProblem === 'required' ? 'apiError.refundReasonText' : 'refund.reasonTextLong')}</p>}
        </Field>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-charcoal/80">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-forest" checked={other} onChange={(e) => setOther(e.target.checked)} />
          <span>{t('refund.otherAccount')}</span>
        </label>
      </div>

      {chosen.length > 0 && (
        <section className="mt-5 rounded-card border border-charcoal/10 bg-ivory/60 p-4" aria-live="polite">
          {!current && <p className="text-sm text-charcoal/55"><Icon name="refresh" className="mr-1 inline h-3.5 w-3.5 animate-spin" />{t('refund.counting')}</p>}
          {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
          {current?.q && (
            <>
              {current.q.requests.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-sm">
                    <thead><tr className="text-left text-xs text-charcoal/55">
                      <th scope="col" className="pb-2 font-medium">{t('refund.course')}</th>
                      <th scope="col" className="pb-2 text-right font-medium">{t('refund.price')}</th>
                      <th scope="col" className="pb-2 text-right font-medium">{t('refund.lessonsHeld')}</th>
                      <th scope="col" className="pb-2 text-right font-medium">{t('refund.amount')}</th>
                    </tr></thead>
                    <tbody>
                      {current.q.requests.flatMap((r) => r.lines.map((l) => (
                        <tr key={`${r.paymentId}-${l.enrollmentId}`} className="border-t border-charcoal/8">
                          <th scope="row" className="py-2 pr-3 text-left font-normal text-charcoal">{title(l.courseId, l.courseTitle)}</th>
                          <td className="py-2 text-right tabular-nums text-charcoal/70">{formatMinor(l.priceMinor)}</td>
                          <td className="py-2 text-right tabular-nums text-charcoal/70">{t('refund.lessonsOf', { held: l.lessonsHeld, total: l.lessonsTotal })}</td>
                          <td className="py-2 text-right font-medium tabular-nums text-charcoal">{formatMinor(l.amountMinor)}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              )}
              {reason === 'PLATFORM_FAULT'
                ? <p className="mt-2 text-sm text-charcoal/70">{t('refund.platformFault')}</p>
                : total && total !== '0'
                  ? <p className="mt-3 font-display text-2xl text-charcoal">{t('refund.total', { amount: formatMinor(total) })}</p>
                  : <Notice tone="warn" className="mt-2">{t('refund.nothing')}</Notice>}
            </>
          )}
        </section>
      )}
    </Modal>
  )
}

/** «Мои заявки на возврат»: status, amounts, the decision; a request waiting for the decision can be withdrawn. */
export function MyRefunds({ round }: { round: number }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const title = useCourseTitle()
  const [items, setItems] = useState<RefundRequestDto[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [mine, setMine] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    myRefunds.list().then((l) => { if (live) { setItems(l); setError(null) } }, (e) => { if (live) setError(e) })
    return () => { live = false }
  }, [round, mine])

  const withdraw = async (r: RefundRequestDto) => {
    if (!confirm(t('refund.withdrawConfirm'))) return
    setBusy(r.id)
    try { await myRefunds.withdraw(r.id); notify(t('refund.withdrawn')); setMine((n) => n + 1) } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }

  const sorted = items ?? []
  if (error != null) return <Notice tone="warn" className="mt-8">{apiErrorText(error, lang)}</Notice>
  if (!sorted.length) return null
  return (
    <section className="mt-10" aria-labelledby="my-refunds">
      <Eyebrow className="mb-3"><span id="my-refunds">{t('refund.mine')}</span></Eyebrow>
      <ul className="space-y-3">
        {sorted.map((r) => (
          <li key={r.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={STATUS_TONE[r.status]}>{t(`refund.status.${r.status}`)}</Badge>
                  {r.source === 'EMAIL' && <Badge tone="muted">{t('refund.source.EMAIL')}</Badge>}
                  {r.toOtherAccount && <Badge tone="muted">{t('refund.toOtherAccountBadge')}</Badge>}
                  <span className="text-xs text-charcoal/55">{t('refund.created', { date: formatDate(r.createdAt, lang) })} · {t(`refund.reason.${r.reason}`)}</span>
                </div>
                <div className="text-right">
                  <div className="text-xs text-charcoal/50">{r.approvedMinor ? t('refund.approvedSum') : t('refund.requested')}</div>
                  <div className="font-display text-2xl text-charcoal">{formatMinor(r.approvedMinor ?? r.requestedMinor)} <span className="text-sm text-charcoal/60">{t('common.som')}</span></div>
                </div>
              </div>
              {r.lines.length > 0 && <p className="mt-2 text-sm text-charcoal/70">{r.lines.map((l) => title(l.courseId, l.courseTitle)).join(', ')}</p>}
              {r.reasonText && <p className="mt-1 text-xs text-charcoal/55">«{r.reasonText}»</p>}
              {r.status === 'PENDING' && <p className="mt-2 text-xs text-charcoal/60">{t('refund.dueBy', { date: formatDate(r.decisionDueAt, lang) })}</p>}
              {r.status === 'APPROVED' && <Notice tone="ok" className="mt-3 text-xs">{t('refund.approvedNote')}</Notice>}
              {r.status === 'PAID' && r.paidAt && <p className="mt-2 text-xs text-forest">{t('refund.paidOn', { date: formatDate(r.paidAt, lang) })}</p>}
              {r.decisionNote && <p className="mt-2 text-sm"><span className="text-charcoal/55">{t('refund.decisionNote')}:</span> {r.decisionNote}</p>}
              {r.status === 'PENDING' && (
                <Button size="sm" variant="ghost" className="mt-3 text-red-800" disabled={busy !== null} onClick={() => void withdraw(r)}>
                  <Icon name="x" className="h-3.5 w-3.5" />{t('refund.withdraw')}
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}
