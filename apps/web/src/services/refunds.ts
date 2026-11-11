import type { L } from '@ilmora/shared'
import { api } from '../lib/api'

/** Reasons of a refund request (offer 6.3–6.5, appendix 2), in the order the form offers them. */
export const REFUND_REASONS = ['REFUSAL', 'SCHEDULE_CHANGED', 'GROUP_CLOSED', 'LESSONS_NOT_HELD', 'NOT_AS_DESCRIBED', 'PLATFORM_FAULT', 'OTHER'] as const
export type RefundReason = (typeof REFUND_REASONS)[number]
export const REFUND_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAID', 'WITHDRAWN'] as const
export type RefundStatus = (typeof REFUND_STATUSES)[number]

/** Reasons that end the chosen courses when the request is filed (6.4): their seats are freed at once. */
export const ENDS_COURSE: ReadonlySet<RefundReason> = new Set(['REFUSAL', 'OTHER', 'SCHEDULE_CHANGED', 'GROUP_CLOSED', 'NOT_AS_DESCRIBED'])

/** Money is tiyin as a string of digits (a bigint does not survive JSON). */
export interface RefundLineDto {
  enrollmentId: string; courseId: string; courseTitle: L | string | null; priceMinor: string; lessonsTotal: number; lessonsHeld: number; amountMinor: string
}
export interface RefundRequestDto {
  id: string; status: RefundStatus; reason: RefundReason; reasonText: string | null; source: 'CABINET' | 'EMAIL'; toOtherAccount: boolean
  paymentId: string; subscriptionId: string; requestedMinor: string; approvedMinor: string | null; currency: string; decisionDueAt: string
  decidedAt: string | null; decisionNote: string | null; paidAt: string | null; providerRef: string | null; createdAt: string; lines: RefundLineDto[]
}
export interface AdminRefundDto extends RefundRequestDto {
  overdue: boolean
  student: { id: string; displayName: string }
  payment: { id: string; amountMinor: string; refundedMinor: string; provider: string | null; paidAt: string | null; periodStart: string; periodEnd: string; state: string }
}
export interface RefundQuoteDto {
  endsCourses: boolean
  requests: { paymentId: string; requestedMinor: string; currency: string; lines: RefundLineDto[] }[]
}
/** What the form sends: the chosen courses (enrollments), the reason, «to another account». */
export interface RefundForm { enrollmentIds: string[]; allCourses: boolean; reason: RefundReason; reasonText: string; toOtherAccount: boolean }
/** An active course of the subscription, as the refund form lists it. */
export interface RefundableCourse { enrollmentId: string; courseId: string; groupId: string }

export const REASON_TEXT_MAX = 1000
/** «Other» needs words; every reason may carry up to 1000 characters. */
export const reasonTextProblem = (f: Pick<RefundForm, 'reason' | 'reasonText'>): 'required' | 'tooLong' | null =>
  f.reasonText.trim().length > REASON_TEXT_MAX ? 'tooLong' : f.reason === 'OTHER' && !f.reasonText.trim() ? 'required' : null

/** The body of a quote or a request: every course of the subscription is sent as «all» (no list), as the API counts it. */
export function refundBody(f: RefundForm) {
  const text = f.reasonText.trim()
  return {
    ...(f.allCourses ? {} : { enrollmentIds: [...new Set(f.enrollmentIds)] }),
    reason: f.reason,
    ...(text ? { reasonText: text } : {}),
    ...(f.toOtherAccount ? { toOtherAccount: true } : {}),
  }
}

/** Tiyin → so'm with spaces between thousands, tiyin after a comma when there are any: «72 000», «45 312,50». */
export function formatMinor(minor: string | null | undefined): string {
  if (!minor || !/^\d+$/.test(minor)) return '—'
  const n = BigInt(minor)
  const whole = (n / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const tiyin = n % 100n
  return tiyin ? `${whole},${tiyin.toString().padStart(2, '0')}` : whole
}

/** What a finance admin types (so'm, spaces, a comma or a dot before tiyin) → tiyin as digits; null when it is not an amount. */
export function parseSom(text: string): string | null {
  const s = text.replace(/[\s ]/g, '').replace(',', '.')
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const minor = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0')
  return minor.toString()
}

/** The approved amount: more than zero and at most what is left of the payment (as the API checks). */
export function approveProblem(minor: string | null, payment: { amountMinor: string; refundedMinor: string }): 'invalid' | 'zero' | 'tooMuch' | null {
  if (minor === null) return 'invalid'
  if (BigInt(minor) <= 0n) return 'zero'
  return BigInt(minor) > BigInt(payment.amountMinor) - BigInt(payment.refundedMinor) ? 'tooMuch' : null
}
export const leftOf = (p: { amountMinor: string; refundedMinor: string }) => (BigInt(p.amountMinor) - BigInt(p.refundedMinor)).toString()

/** The finance admin's note: a rejection needs 3–1000 characters; the transfer's reference 3–200. */
export const noteOk = (s: string) => s.trim().length >= 3 && s.trim().length <= 1000
export const providerRefOk = (s: string) => s.trim().length >= 3 && s.trim().length <= 200

const id = (s: string) => encodeURIComponent(s)

/** The student's refund requests (`/v1/student/subscription/refunds`, offer 6.3–6.6). */
export const myRefunds = {
  /** The subscription's active courses with their enrollment ids, for choosing what to refuse. */
  courses: async (): Promise<RefundableCourse[]> => {
    const o = await api<{ subscription: { enrollments?: { id: string; status: string; courseId: string; group: { id: string } }[] } | null }>('/student/subscription')
    return (o.subscription?.enrollments ?? []).filter((e) => e.status === 'ACTIVE').map((e) => ({ enrollmentId: e.id, courseId: e.courseId, groupId: e.group.id }))
  },
  /** What the request would return, before it is filed; nothing is written. */
  quote: (f: RefundForm) => api<RefundQuoteDto>('/student/subscription/refunds/quote', { method: 'POST', body: refundBody(f) }),
  file: (f: RefundForm) => api<{ ok: true; endsCourses: boolean; requests: { id: string; paymentId: string; requestedMinor: string }[] }>('/student/subscription/refunds', { method: 'POST', body: refundBody(f) }),
  list: () => api<RefundRequestDto[]>('/student/subscription/refunds'),
  /** Only while the request waits for the decision; freed seats are not given back. */
  withdraw: (requestId: string) => api<{ ok: true }>(`/student/subscription/refunds/${id(requestId)}/withdraw`, { method: 'POST' }),
}

export interface RefundQueueFilter { status: RefundStatus | ''; overdue: boolean; page: number }

/** The finance admins' queue (`/v1/admin/finance/refunds`): decision within 10 days, money within 5 working days. */
export const refundQueue = {
  list: (f: RefundQueueFilter) => {
    const q = new URLSearchParams({ pageSize: '30', ...(f.status ? { status: f.status } : {}), ...(f.overdue ? { overdue: 'true' } : {}), ...(f.page > 1 ? { page: String(f.page) } : {}) })
    return api<{ page: number; pageSize: number; total: number; items: AdminRefundDto[] }>(`/admin/finance/refunds?${q}`)
  },
  approve: (requestId: string, approvedMinor: string, note: string) =>
    api<{ ok: true }>(`/admin/finance/refunds/${id(requestId)}/approve`, { method: 'POST', body: { approvedMinor, ...(note.trim() ? { note: note.trim() } : {}) } }),
  reject: (requestId: string, note: string) => api<{ ok: true }>(`/admin/finance/refunds/${id(requestId)}/reject`, { method: 'POST', body: { note: note.trim() } }),
  /** The money was sent: the bank transfer's number or Payme's reference. */
  paid: (requestId: string, providerRef: string) => api<{ ok: true }>(`/admin/finance/refunds/${id(requestId)}/paid`, { method: 'POST', body: { providerRef: providerRef.trim() } }),
  /** A request that came by e-mail (appendix 2), entered for the student: the whole subscription. */
  fromLetter: (studentId: string, f: RefundForm) => api<{ ok: true }>('/admin/finance/refunds', { method: 'POST', body: { studentId, ...refundBody(f) } }),
}
