/** Roles the Super Admin may assign through the roles endpoint (the Super Admin role itself is never assignable). */
const ASSIGNABLE = ['FINANCE_ADMIN', 'CENTER_ADMIN', 'CENTER_MANAGER', 'TEACHER', 'STUDENT'] as const
export type AssignableRole = (typeof ASSIGNABLE)[number]
/**
 * Roles the endpoint never sets and the API keeps as they are: the roles given by their own flows (ministry accounts,
 * institution and company claims). A body without them does not remove them. An owner's pair is kept too, but an owner
 * is told by the isOwner flag, not by the roles column.
 */
const SERVER_KEPT = ['MINISTRY', 'INSTITUTION_ADMIN', 'COMPANY_ADMIN']

/** The part of an account's roles the roles endpoint takes, in a stable order. */
export const siteRoles = (roles: string[]): AssignableRole[] => ASSIGNABLE.filter((r) => roles.includes(r))
/** True when the account keeps a role the API preserves, so an empty list of site roles is still a valid body (owners: check isOwner). */
export const hasServerKeptRole = (roles: string[]): boolean => roles.some((r) => SERVER_KEPT.includes(r))

/** The roles endpoint replaces the site roles, so adding center admin must keep everything else the person already has. */
export const withCenterAdmin = (roles: string[]): AssignableRole[] => ASSIGNABLE.filter((r) => r === 'CENTER_ADMIN' || roles.includes(r))

/** Removing center admin keeps the other roles; a person with no other role at all keeps the student role. */
export const withoutCenterAdmin = (roles: string[]): AssignableRole[] => {
  const rest = ASSIGNABLE.filter((r) => r !== 'CENTER_ADMIN' && roles.includes(r))
  return rest.length > 0 || hasServerKeptRole(roles) ? rest : ['STUDENT']
}
