/** Roles the Super Admin may assign through the roles endpoint (the Super Admin role itself is never assignable). */
const ASSIGNABLE = ['FINANCE_ADMIN', 'CENTER_ADMIN', 'TEACHER', 'STUDENT'] as const
export type AssignableRole = (typeof ASSIGNABLE)[number]

/** The roles endpoint replaces the whole list, so adding center admin must keep everything else the person already has. */
export const withCenterAdmin = (roles: string[]): AssignableRole[] => ASSIGNABLE.filter((r) => r === 'CENTER_ADMIN' || roles.includes(r))

/** Removing center admin keeps the other roles; a person always keeps at least the student role. */
export const withoutCenterAdmin = (roles: string[]): AssignableRole[] => {
  const rest = ASSIGNABLE.filter((r) => r !== 'CENTER_ADMIN' && roles.includes(r))
  return rest.length > 0 ? rest : ['STUDENT']
}
