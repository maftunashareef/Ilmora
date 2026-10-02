/**
 * Builds can be served from a sub-path (e.g. GitHub Pages: /ilmora-demo/).
 * Root-relative asset URLs stored in demo data ("/media/…") are prefixed with Vite's base URL.
 */
const base = import.meta.env.BASE_URL.replace(/\/$/, '')

export const withBase = (url: string): string => (url && url.startsWith('/') && !url.startsWith('//') ? `${base}${url}` : url)

/** Router basename for the same sub-path ('' when served from the root). */
export const routerBasename = base
