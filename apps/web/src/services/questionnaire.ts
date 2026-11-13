'use client'
import { useCallback, useEffect, useState } from 'react'
import { firstIncompleteStep, type StudentQuestionnaire } from '@ilmora/shared'
import { api, isApiError } from '../lib/api'

/**
 * The signed-in student's questionnaire (ТЗ 4.1).
 *
 * API contract (served by the API team):
 *   GET /v1/students/me/questionnaire → { questionnaire: StudentQuestionnaire | null, complete: boolean,
 *                                         studyConfirmed: 'CONFIRMED' | 'PENDING' | 'REJECTED' | null }
 *   PUT /v1/students/me/questionnaire  StudentQuestionnaire → same shape. The server checks it with
 *       validateQuestionnaireStep (shared) and adds an institution typed by the student to the registry (ТЗ 3.5).
 *
 * `questionnaire.consents` and `questionnaire.guardianConsent` say what is in force; saving does not change consents —
 * they are given and taken back on «Мои согласия» (services/consents.ts). The one exception: the mark «согласие
 * родителя получено» of a minor's first questionnaire, while `parentConsentOnRecord` is false.
 */
export interface QuestionnaireState {
  questionnaire: StudentQuestionnaire | null
  /** For a minor: only with the parent's consent in force. */
  complete: boolean
  /** Whether the institution confirmed the student studies there (ТЗ 4.1 "Подтверждение учёбы"). */
  studyConfirmed: 'CONFIRMED' | 'PENDING' | 'REJECTED' | null
  /** The parent's consent is in the journal, in force or taken back: step 3 no longer asks for its mark. */
  parentConsentOnRecord?: boolean
}

/** Everything is filled in, and the only thing a minor's questionnaire lacks is the parent's consent, taken back on «Мои согласия». */
export const onlyParentConsentMissing = (s: QuestionnaireState, today: Date): boolean =>
  !s.complete && !!s.questionnaire && !!s.parentConsentOnRecord && firstIncompleteStep(s.questionnaire, today, [], true) === null

export const saveQuestionnaire = (q: StudentQuestionnaire) => api<QuestionnaireState>('/students/me/questionnaire', { method: 'PUT', body: q })

export function useQuestionnaire() {
  const [data, setData] = useState<QuestionnaireState | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const reload = useCallback(async () => {
    try {
      setData(await api<QuestionnaireState>('/students/me/questionnaire'))
      setStatus('ready')
    } catch (err) {
      // No questionnaire yet (or the endpoint is not live yet): treat as empty, the student fills it in.
      if (isApiError(err) && (err.status === 404 || err.status === 0)) { setData({ questionnaire: null, complete: false, studyConfirmed: null }); setStatus('ready') }
      else setStatus('error')
    }
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { data, status, setData, reload }
}
