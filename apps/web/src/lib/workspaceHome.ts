/** Private workspaces of the app; paths outside them are open to any signed-in account. */
export type Workspace = 'admin' | 'teacher' | 'center' | 'student' | 'ministry'

const PREFIXES: [string, Workspace][] = [['/admin', 'admin'], ['/teacher', 'teacher'], ['/center', 'center'], ['/student', 'student'], ['/ministry', 'ministry']]

export const workspaceOf = (path: string): Workspace | null => PREFIXES.find(([p]) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))?.[1] ?? null

/** Whether an account with these roles may open the path (used for `next` targets after sign-in). */
export const canOpen = (roles: readonly string[], target: string): boolean => {
  // The query and hash do not change the page: «/admin/finance?tab=refunds&request=…» is the finance page.
  const path = target.split(/[?#]/)[0]
  const w = workspaceOf(path)
  if (!w || roles.includes('PLATFORM_ADMIN')) return true
  // Finance admins may open the finance page of the admin workspace, nothing else in it.
  if (w === 'admin') return roles.includes('FINANCE_ADMIN') && (path === '/admin/finance' || path.startsWith('/admin/finance/'))
  if (w === 'ministry') return roles.includes('MINISTRY')
  return w === 'teacher' ? roles.includes('TEACHER') : w === 'center' ? roles.includes('CENTER_ADMIN') : roles.includes('STUDENT')
}

/** Landing page after sign-in, in the same precedence as the store's `roleOf`; used after every sign-in. */
export const homeFor = (roles: readonly string[]): string =>
  roles.includes('PLATFORM_ADMIN') ? '/admin' : roles.includes('TEACHER') ? '/teacher' : roles.includes('CENTER_ADMIN') ? '/center' : roles.includes('FINANCE_ADMIN') ? '/admin/finance'
    : roles.includes('MINISTRY') ? '/ministry'
    // The institution's or company's representative has no workspace yet (/institution and /company come next): the
    // home page, not /student.
    : roles.includes('INSTITUTION_ADMIN') || roles.includes('COMPANY_ADMIN') ? '/'
    : '/student'
