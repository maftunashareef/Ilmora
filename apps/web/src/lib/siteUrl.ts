/** The public site's origin, for links that must leave the admin host (empty locally, where one origin serves both). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')

/** An href for a public page: absolute when the public site has its own origin, relative otherwise. */
export const siteHref = (lang: string, path: string) => (SITE_URL ? `${SITE_URL}/${lang}${path}` : path)
