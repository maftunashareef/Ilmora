/** Private workspaces of the app; paths outside them are open to any signed-in account. */
export type Workspace = 'admin' | 'teacher' | 'center' | 'student'

export const workspaceOf = (path: string): Workspace | null =>
  path.startsWith('/admin') ? 'admin' : path.startsWith('/teacher') ? 'teacher' : path.startsWith('/center') ? 'center' : path.startsWith('/student') ? 'student' : null

/** Whether an account with these roles may open the path (used for `next` targets after sign-in). */
export const canOpen = (roles: readonly string[], path: string): boolean => {
  const w = workspaceOf(path)
  if (!w || roles.includes('PLATFORM_ADMIN')) return true
  // Finance admins may open the finance page of the admin workspace, nothing else in it.
  if (w === 'admin') return roles.includes('FINANCE_ADMIN') && (path === '/admin/finance' || path.startsWith('/admin/finance/'))
  return w === 'teacher' ? roles.includes('TEACHER') : w === 'center' ? roles.includes('CENTER_ADMIN') : roles.includes('STUDENT')
}

/** Landing page after sign-in, in the same precedence as the store's `roleOf`; used after every sign-in. */
export const homeFor = (roles: readonly string[]): string =>
  roles.includes('PLATFORM_ADMIN') ? '/admin' : roles.includes('TEACHER') ? '/teacher' : roles.includes('CENTER_ADMIN') ? '/center' : roles.includes('FINANCE_ADMIN') ? '/admin/finance'
    // An institution's or a company's representative has no workspace yet (/institution, /company come next): the home page, not /student.
    : roles.includes('INSTITUTION_ADMIN') || roles.includes('COMPANY_ADMIN') ? '/'
    : '/student'
