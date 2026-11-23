/**
 * The address of a request as the server logs it (security review 19.11, №11): the path only — no query string (QR
 * tokens, return addresses) — and with the center's standing QR code masked. That code never changes on its own, so a
 * log line holding it is a working QR for the center: `/attendance/centers/<code>` (API) and `/attend/c/<code>` (the
 * QR page of the site, when it passes through) become `…/:code`. Caddy masks the same paths in its own log
 * (infra/uzcloud/web/caddy/Caddyfile).
 */
const CENTER_CODE = /\/(attendance\/centers|attend\/c)\/[^/?#]+/g

export function logPath(url: string | undefined | null): string {
  return (url ?? '').split('?')[0].split('#')[0].replace(CENTER_CODE, '/$1/:code')
}
