/** Private workspaces of the app; paths outside them are open to any signed-in account. */
export type Workspace = 'admin' | 'teacher' | 'center' | 'student' | 'ministry' | 'institution' | 'company'

const PREFIXES: [string, Workspace][] = [['/admin', 'admin'], ['/teacher', 'teacher'], ['/center', 'center'], ['/student', 'student'], ['/ministry', 'ministry'], ['/institution', 'institution'], ['/company', 'company']]

export const workspaceOf = (path: string): Workspace | null => PREFIXES.find(([p]) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))?.[1] ?? null

/**
 * The center's manager (№15, 19.11; Тимур, 23.11): the students' table and the journal (and notifications) of the center
 * workspace — not courses, teachers, settings or the overview with its figures.
 */
const MANAGER_PAGES = ['/center/students', '/center/journal', '/center/notifications']
export const managerOpens = (path: string): boolean => MANAGER_PAGES.some((p) => path === p || path.startsWith(`${p}/`))
/** A manager and nothing above it in the center: the workspace narrows to MANAGER_PAGES. */
export const isCenterManagerOnly = (roles: readonly string[]): boolean => roles.includes('CENTER_MANAGER') && !roles.includes('CENTER_ADMIN') && !roles.includes('PLATFORM_ADMIN')

/** Whether an account with these roles may open the path (used for `next` targets after sign-in). */
export const canOpen = (roles: readonly string[], target: string): boolean => {
  // The query and hash do not change the page: «/admin/finance?tab=refunds&request=…» is the finance page.
  const path = target.split(/[?#]/)[0]
  const w = workspaceOf(path)
  if (!w || roles.includes('PLATFORM_ADMIN')) return true
  // Finance admins may open the finance page of the admin workspace, nothing else in it.
  if (w === 'admin') return roles.includes('FINANCE_ADMIN') && (path === '/admin/finance' || path.startsWith('/admin/finance/'))
  if (w === 'ministry') return roles.includes('MINISTRY')
  if (w === 'institution') return roles.includes('INSTITUTION_ADMIN')
  if (w === 'company') return roles.includes('COMPANY_ADMIN')
  if (w === 'center') return roles.includes('CENTER_ADMIN') || (roles.includes('CENTER_MANAGER') && managerOpens(path))
  return w === 'teacher' ? roles.includes('TEACHER') : roles.includes('STUDENT')
}

/** Landing page after sign-in, in the same precedence as the store's `roleOf`; used after every sign-in. */
export const homeFor = (roles: readonly string[]): string =>
  roles.includes('PLATFORM_ADMIN') ? '/admin' : roles.includes('TEACHER') ? '/teacher' : roles.includes('CENTER_ADMIN') ? '/center' : roles.includes('CENTER_MANAGER') ? '/center/students' : roles.includes('FINANCE_ADMIN') ? '/admin/finance'
    : roles.includes('MINISTRY') ? '/ministry'
    : roles.includes('INSTITUTION_ADMIN') ? '/institution'
    : roles.includes('COMPANY_ADMIN') ? '/company'
    : '/student'
