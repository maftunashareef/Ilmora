'use client'
import { NotificationsPage } from '../../components/NotificationsPage'
import { useT } from '../../i18n/useT'

/** The notifications page of each dashboard: the same list, under the dashboard's own heading. */
export function AdminNotifications() { const { t } = useT(); return <NotificationsPage role="admin" eyebrow={t('dash.admin')} /> }
export function CenterNotifications() { const { t } = useT(); return <NotificationsPage role="center" eyebrow={t('dash.center')} /> }
export function TeacherNotifications() { const { t } = useT(); return <NotificationsPage role="teacher" eyebrow={t('dash.teacherStudio')} /> }
export function StudentNotifications() { const { t } = useT(); return <NotificationsPage role="student" eyebrow={t('dash.studentSpace')} /> }
