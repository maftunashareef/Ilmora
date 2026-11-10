'use client'
import { useCallback, useEffect, useState } from 'react'
import type { StudentQuestionnaire } from '@ilmora/shared'
import { api, isApiError } from '../lib/api'

/**
 * The signed-in student's questionnaire (ТЗ 4.1).
 *
 * API contract (served by the API team):
 *   GET /v1/students/me/questionnaire → { questionnaire: StudentQuestionnaire | null, complete: boolean,
 *                                         studyConfirmed: 'CONFIRMED' | 'PENDING' | 'REJECTED' | null }
 *   PUT /v1/students/me/questionnaire  StudentQuestionnaire → same shape. The server checks it with
 *       validateQuestionnaireStep (shared) and adds an institution typed by the student to the registry (ТЗ 3.5).
 */
export interface QuestionnaireState {
  questionnaire: StudentQuestionnaire | null
  complete: boolean
  /** Whether the institution confirmed the student studies there (ТЗ 4.1 "Подтверждение учёбы"). */
  studyConfirmed: 'CONFIRMED' | 'PENDING' | 'REJECTED' | null
}

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
