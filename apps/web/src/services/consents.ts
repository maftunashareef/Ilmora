import { consentGiveBlock, STUDENT_CONSENT_KEYS, type ConsentGiveBlock, type StudentConsentActionKind, type StudentConsentDto, type StudentQuestionnaire } from '@ilmora/shared'
import type { TKey } from '../i18n/translations'
import { api } from '../lib/api'

/**
 * «Мои согласия» (ТЗ 8): the student gives and takes back each consent by its own action, apart from the questionnaire.
 * API: `GET /students/me/consents` — the journal; `POST /students/me/consents/:kind/give | revoke` — both answer with
 * the journal. Taking a consent back never depends on the questionnaire.
 */
export const consentsApi = {
  journal: () => api<StudentConsentDto[]>('/students/me/consents'),
  give: (kind: StudentConsentActionKind) => api<StudentConsentDto[]>(`/students/me/consents/${kind}/give`, { method: 'POST' }),
  revoke: (kind: StudentConsentActionKind) => api<StudentConsentDto[]>(`/students/me/consents/${kind}/revoke`, { method: 'POST' }),
}

/** The text of each consent (working wording until the lawyer's review; see translations.ts). */
export const CONSENT_TEXT: Record<StudentConsentActionKind, TKey> = {
  PARENT_CONSENT: 'q.guardianConsent', GRADUATE_CARD: 'q.consent.GRADUATE_CARD', CONTRACT_HELP_CARD: 'q.consent.CONTRACT_HELP_CARD', INDUSTRY_CARD: 'q.consent.INDUSTRY_CARD',
}

/**
 * What the student is told before taking a consent back — its own for each kind: a named card leaves at once while
 * contacts already received and requests already sent stay; the anonymous card carries no contacts; the parent's
 * consent hides every card.
 */
export const REVOKE_WARNING: Record<StudentConsentActionKind, TKey> = {
  GRADUATE_CARD: 'st.c.revokeConfirm.card', INDUSTRY_CARD: 'st.c.revokeConfirm.card', CONTRACT_HELP_CARD: 'st.c.revokeConfirm.anonymous', PARENT_CONSENT: 'st.c.revokeConfirm.parent',
}

export interface ConsentRow {
  kind: StudentConsentActionKind
  /** The journal row in force, if any. */
  active: StudentConsentDto | null
  /** Why «Дать согласие» is closed now (the API refuses with the same code); null — it can be given. */
  block: ConsentGiveBlock | null
}

/**
 * The rows of «Мои согласия», by the API's own rule (`consentGiveBlock`). A consent in force is always shown — it can
 * always be taken back. One that does not apply is not offered: the parent's consent to an adult (or before there is a
 * questionnaire), «компании моей отрасли» while the questionnaire says «хочу поступить».
 */
export function consentRows(q: StudentQuestionnaire | null | undefined, journal: StudentConsentDto[], today: Date): ConsentRow[] {
  const active = (kind: StudentConsentActionKind) => journal.find((c) => c.kind === kind && c.active && !c.company) ?? null
  const state = q ? { status: q.status, birthDate: q.birthDate, hasGuardian: !!q.guardianName.trim() && !!q.guardianPhone.trim(), parentConsent: !!active('PARENT_CONSENT') } : null
  const kinds: StudentConsentActionKind[] = ['PARENT_CONSENT', ...STUDENT_CONSENT_KEYS]
  return kinds
    .map((kind) => ({ kind, active: active(kind), block: consentGiveBlock(kind, state, today) }))
    .filter((r) => r.active || !(r.block === 'parent_consent_adult' || r.block === 'consent_studying_only' || (r.kind === 'PARENT_CONSENT' && r.block === 'questionnaire_required')))
}
