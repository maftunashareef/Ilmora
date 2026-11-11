/** Security headers of the web app (used by next.config.ts; kept apart so tests can read them). */

/** '' or '/' means the browser reaches the API through this host (rewrites below); the CSP then needs no extra origin. */
export const SAME_ORIGIN_API = process.env.NEXT_PUBLIC_API_URL === '' || process.env.NEXT_PUBLIC_API_URL === '/'
const apiOrigin = (() => {
  if (SAME_ORIGIN_API) return ''
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').origin
  } catch {
    return 'http://localhost:4000'
  }
})()

/** Remote images only from the configured S3-compatible public bucket (narrow pattern, no wildcards hosts). */
export const remotePatterns = (() => {
  const base = process.env.NEXT_PUBLIC_MEDIA_BASE_URL
  if (!base) return []
  try {
    const u = new URL(base)
    return [{ protocol: u.protocol.replace(':', '') as 'http' | 'https', hostname: u.hostname, port: u.port || undefined, pathname: `${u.pathname.replace(/\/$/, '')}/**` }]
  } catch {
    return []
  }
})()

/**
 * Origin of the object storage (from NEXT_PUBLIC_MEDIA_BASE_URL): images load from it, and the browser uploads there with
 * presigned PUTs, including private documents, whose bucket sits on the same storage host (path-style addresses).
 */
const storageOrigins = remotePatterns.map((p) => `${p.protocol}://${p.hostname}${p.port ? `:${p.port}` : ''}`).join(' ')

/** Where a static file of ours lives: the policy for them (and only them) comes from next.config.ts, not from proxy.ts. */
export const STATIC_PREFIXES = ['_next', 'brand', 'media'] as const

/**
 * The Content-Security-Policy. A page gets a fresh `nonce` per request from proxy.ts: scripts run only with it — Next.js
 * puts it on its own scripts — and 'strict-dynamic' lets them load the code chunks. No 'unsafe-inline' for scripts
 * (М-3): an injected inline script does not run. Static files get the policy without a nonce: nothing inline at all.
 * Styles keep 'unsafe-inline' — React style attributes and the animation libraries need it, and a nonce does not cover them.
 */
export function contentSecurityPolicy(nonce?: string): string {
  // React dev tooling needs eval; production bundles never do.
  const dev = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"
  return [
    "default-src 'self'",
    nonce ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev}` : `script-src 'self'${dev}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${storageOrigins}`.trim(),
    "font-src 'self' data:",
    "media-src 'self' blob:",
    // Lesson videos are embedded from YouTube (privacy-enhanced no-cookie host) and Vimeo; without frame-src these
    // iframes fall back to default-src 'self' and never load. Kept to the exact player origins used in embedFor().
    "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com",
    `connect-src 'self' ${apiOrigin} ${storageOrigins}`.replace(/\s+/g, ' ').trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.paycom.uz https://test.paycom.uz https://my.click.uz",
  ].join('; ')
}

/** A nonce for one page request: 16 random bytes, base64. */
export const newNonce = (): string => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))

/** Headers of every response; the Content-Security-Policy is set apart (proxy.ts for pages, next.config.ts for static files). */
export const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // geolocation=(self): a center with a radius checks where a QR check-in comes from; with geolocation=() the browser
  // refused every location request and honest check-ins failed with location-required.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=()' },
]
