'use client'

/** Last-resort boundary (replaces the root layout), kept dependency-free. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="uz">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#FBF3E3', color: '#1D211C', margin: 0 }}>
        <div style={{ maxWidth: 520, margin: '15vh auto', padding: 32, textAlign: 'center' }}>
          <h1 style={{ fontWeight: 500 }}>ILMORA</h1>
          <p>Xatolik yuz berdi · Произошла ошибка · Something went wrong</p>
          {error.digest && <p style={{ fontSize: 12, opacity: 0.6 }}>ref: {error.digest}</p>}
          <button type="button" onClick={reset} style={{ marginTop: 16, padding: '10px 20px', borderRadius: 10, border: 0, background: '#0E5A44', color: '#FBF3E3' }}>Qayta uriniş · Повторить · Try again</button>
        </div>
      </body>
    </html>
  )
}
