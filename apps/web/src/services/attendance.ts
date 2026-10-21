'use client'
import { PUBLIC_API_URL, session } from '../lib/api'
import { useStore } from '../store/useStore'

export type { CheckInFailure, CheckInInput, CheckInResult } from '@ilmora/shared'

/**
 * Live attendance updates for a session: server-sent events over fetch (so the bearer token can be sent),
 * with the store's polling-free `applyAttendanceEvent` as the sink. Returns a stop function.
 */
export function subscribeToSession(sessionId: string, onEvent?: (e: { type: string }) => void): () => void {
  const controller = new AbortController()
  const run = async () => {
    let attempt = 0
    while (!controller.signal.aborted) {
      try {
        const res = await fetch(`${PUBLIC_API_URL}/v1/teacher/sessions/${sessionId}/stream`, {
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${session.token ?? ''}`, 'X-Requested-With': 'ilmora' },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
        attempt = 0
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'))
            if (!dataLine) continue
            try {
              const event = JSON.parse(dataLine.slice(5).trim()) as { type: string; session?: unknown; record?: unknown }
              useStore.getState().applyAttendanceEvent(event)
              onEvent?.(event)
            } catch {
              /* ignore malformed frames */
            }
          }
        }
      } catch {
        if (controller.signal.aborted) return
      }
      attempt++
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1_000 * 2 ** attempt)))
    }
  }
  void run()
  return () => controller.abort()
}
