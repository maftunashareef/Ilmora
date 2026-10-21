'use client'
import { useEffect } from 'react'

/** Route error boundary: shows a retry without exposing internals (details go to the console / Sentry). */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="container-x py-20">
      <div className="card mx-auto max-w-lg px-8 py-10 text-center">
        <div className="eyebrow mb-2">ILMORA</div>
        <h1 className="font-display text-3xl text-charcoal">Xatolik yuz berdi · Произошла ошибка · Something went wrong</h1>
        {error.digest && <p className="mt-2 text-[11px] text-charcoal/45">ref: {error.digest}</p>}
        <button type="button" onClick={reset} className="mt-6 rounded-control bg-forest px-5 py-2.5 text-sm font-medium text-ivory">Qayta urinish · Повторить · Try again</button>
      </div>
    </div>
  )
}
