import type { MfaService } from '../src/modules/auth/mfa.service'
import type { NotificationsService } from '../src/modules/notifications/notifications.service'

/** Notifications are a side effect of the services under test: this stub records nothing and resolves every look-up empty. */
export const notificationsStub = {
  notify: async () => 0,
  list: async () => ({ items: [], unreadCount: 0 }),
  markRead: async () => ({ unreadCount: 0 }),
  centerAdminIds: async () => [],
  teacherUserId: async () => null,
  groupStudentIds: async () => [],
  ownerIds: async () => [],
  courseStaffIds: async () => [],
  safely: async (_label: string, fn: () => Promise<unknown>) => { await fn() },
} as unknown as NotificationsService

/** Accounts without a second factor (students, teachers, centers): the password opens the session, other sign-ins are allowed. */
export const mfaStub = {
  enforced: () => false,
  gate: async () => null,
  refuseOtherSignIn: () => undefined,
  allowsRefresh: async () => true,
} as unknown as MfaService
