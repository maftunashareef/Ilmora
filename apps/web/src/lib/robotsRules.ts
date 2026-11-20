const LOCALES = ['uz', 'ru', 'en'] as const

/** Workspaces behind sign-in: the index page ("/uz/teacher") and everything under it ("/uz/teacher/groups"). */
const WORKSPACES = ['admin', 'teacher', 'center', 'student']
/** Public-layout pages with nothing to index: personal, one-off or sign-in screens. */
const PRIVATE_PAGES = ['login', 'preview', 'favorites', 'invite']
const PRIVATE_TREES = ['attend', 'payments', 'auth']

/**
 * robots.txt Disallow lines. Rules are prefix matches, so a bare "/uz/teacher" would also close "/uz/teachers" and
 * "/uz/centers" (public catalog pages listed in the sitemap). Each workspace is therefore closed as an exact path
 * ("$", understood by Google, Yandex and Bing) plus its subtree ("/").
 */
export function disallowedPaths(): string[] {
  const perLocale = LOCALES.flatMap((l) => [
    ...WORKSPACES.flatMap((w) => [`/${l}/${w}$`, `/${l}/${w}/`]),
    ...PRIVATE_PAGES.map((p) => `/${l}/${p}`),
    ...PRIVATE_TREES.map((p) => `/${l}/${p}/`),
  ])
  return [...perLocale, '/api/', '/v1/']
}

/** How Google, Yandex and Bing read one Disallow line: prefix match, "*" is any run of characters, a final "$" anchors the end. */
export function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$')
  const body = (anchored ? rule.slice(0, -1) : rule).split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path)
}

export const isDisallowed = (path: string) => disallowedPaths().some((rule) => ruleMatches(rule, path))
