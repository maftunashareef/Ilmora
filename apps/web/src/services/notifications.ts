'use client'
import { PUBLIC_API_URL, refreshSession, session } from '../lib/api'

/**
 * Live notifications: server-sent events over fetch (so the bearer token can be sent). Every ping makes the caller
 * reload the list from the API, so a missed frame never loses anything. Returns a stop function.
 */
export function subscribeToNotifications(onPing: (event: { type: string }) => void): () => void {
  const controller = new AbortController()
  const run = async () => {
    let attempt = 0
    while (!controller.signal.aborted) {
      if (!session.token) {
        await new Promise((r) => setTimeout(r, 2_000))
        continue
      }
      try {
        const res = await fetch(`${PUBLIC_API_URL}/v1/notifications/stream`, {
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${session.token}`, 'X-Requested-With': 'ilmora' },
          signal: controller.signal,
        })
        if (res.status === 401) await refreshSession()
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
              const event = JSON.parse(dataLine.slice(5).trim()) as { type: string }
              if (event.type === 'notification') onPing(event)
            } catch {
              /* ignore malformed frames */
            }
          }
        }
      } catch {
        if (controller.signal.aborted) return
      }
      attempt++
      await new Promise((r) => setTimeout(r, Math.min(60_000, 2_000 * 2 ** attempt)))
    }
  }
  void run()
  return () => controller.abort()
}
