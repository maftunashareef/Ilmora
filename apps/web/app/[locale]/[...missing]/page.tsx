import { notFound } from 'next/navigation'

/**
 * Any address under a language that matches no page: the site's own «not found» page, rendered per request — with the
 * layout, the language and the Content-Security-Policy nonce (М-3). Without it Next.js serves its static default 404,
 * whose scripts carry no nonce and are blocked.
 */
export default function Missing() {
  notFound()
}
