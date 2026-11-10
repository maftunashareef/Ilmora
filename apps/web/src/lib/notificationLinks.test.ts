import { describe, expect, it } from 'vitest'
import { dashboardRole, notificationHref, notificationsPath } from './notificationLinks'

describe('notification links', () => {
  it('sends the owner to the center that registered, and the center to its own workspace', () => {
    const n = { type: 'center.registered', params: { centerId: 'ce-1', centerName: 'Nur' } }
    expect(notificationHref(n, 'admin')).toBe('/admin/centers/ce-1')
    expect(notificationHref({ type: 'center.approved', params: { centerId: 'ce-1' } }, 'center')).toBe('/center')
    expect(notificationHref({ type: 'center.teacherLinked', params: { centerId: 'ce-1' } }, 'teacher')).toBe('/teacher')
  })

  it('opens a refund request in the finance queue, and the student\'s subscription for the student (№42)', () => {
    const n = { type: 'refund.requested', params: { requestId: 'rr-1', queuePath: '/admin/finance?tab=refunds&request=rr-1' } }
    expect(notificationHref(n, 'admin')).toBe('/admin/finance?tab=refunds&request=rr-1')
    expect(notificationHref({ type: 'refund.requested', params: { queuePath: 'https://evil.example/x' } }, 'admin')).toBe('/admin/finance')
    expect(notificationHref({ type: 'refund.paid', params: { requestId: 'rr-1' } }, 'student')).toBe('/student/subscription')
  })

  it('opens the same lesson event in each role’s own place', () => {
    const n = { type: 'attendance.checkin', params: { groupId: 'g-1', date: '2026-11-03', start: '09:00' } }
    expect(notificationHref(n, 'teacher')).toBe('/teacher/groups/g-1')
    expect(notificationHref(n, 'center')).toBe('/center/attendance?date=2026-11-03')
    expect(notificationHref(n, 'student')).toBe('/student/attendance')
    expect(notificationHref({ type: 'schedule.changed', params: { groupId: 'g-1' } }, 'student')).toBe('/student/timetable')
    expect(notificationHref({ type: 'schedule.extra', params: {} }, 'teacher')).toBe('/teacher/groups')
  })

  it('points money and access events at the subscription page, and unknown types at the notifications page', () => {
    expect(notificationHref({ type: 'subscription.expiring', params: { days: 3 } }, 'student')).toBe('/student/subscription')
    expect(notificationHref({ type: 'payment.confirmed', params: {} }, 'student')).toBe('/student/subscription')
    expect(notificationHref({ type: 'something.new', params: {} }, 'center')).toBe('/center/notifications')
    expect(notificationsPath('admin')).toBe('/admin/notifications')
    expect(dashboardRole('visitor')).toBeNull()
    expect(dashboardRole('teacher')).toBe('teacher')
  })
})
